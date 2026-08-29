import { Telegraf } from 'telegraf';
import { config } from '../config';
import { getAllActivePositions } from '../db/repositories/positions';
import { getWallet } from '../db/repositories/wallets';
import {
  getCoinPrice as getHlPrice,
  getUserState,
  type HLPosition,
} from './hyperliquidService';
import {
  closePositionByMessage,
  closePositionRecord,
  closePartialRealPosition,
  isStopLossHit,
  isTakeProfitHit,
  isPartialTpTriggered,
  getLiquidationPrice,
  autoStartTrade,
  setPositionMessageId,
} from './tradeService';
import { updatePositionPartialTp } from '../db/repositories/positions';
import { getUser, updateUserBalance } from '../db/repositories/users';
import { logPerformance } from '../db/repositories/performance';
import {
  buildClosedPositionText,
  buildActivePositionText,
} from '../bot/messages';
import { positionKeyboard } from '../bot/keyboards';
import type { ActivePosition, Wallet } from '../types';

function coinFromSymbol(symbol: string): string {
  return symbol.replace('USDT', '').replace('USDC', '');
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

export function startPositionMonitor(bot: Telegraf): void {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;

    try {
      await runMonitorTick(bot);
    } catch (error) {
      console.error('Position monitor tick error:', error);
    } finally {
      tickRunning = false;
    }
  }, config.positionPollIntervalMs);

  console.log(
    `Position monitor started (interval: ${config.positionPollIntervalMs}ms)`
  );
}

async function notifyPositionClosed(
  bot: Telegraf,
  position: ActivePosition,
  text: string,
  forceNewMessage: boolean
): Promise<void> {
  let edited = false;
  if (position.messageId > 0) {
    try {
      await bot.telegram.editMessageText(
        position.chatId,
        position.messageId,
        undefined,
        text,
        { parse_mode: 'HTML' }
      );
      edited = true;
    } catch {
      // Message may have been deleted
    }
  }

  if (forceNewMessage || !edited) {
    await bot.telegram
      .sendMessage(position.chatId, text, { parse_mode: 'HTML' })
      .catch(() => {});
  }
}

async function runMonitorTick(bot: Telegraf): Promise<void> {
  const positions = await getAllActivePositions();

  const realWallets = new Map<number, Wallet>();
  const exchangePositions = new Map<string, HLPosition[]>();

  for (const position of positions) {
    if (position.accountMode !== 'real' || realWallets.has(position.chatId)) continue;
    const wallet = await getWallet(position.chatId).catch(() => null);
    if (!wallet?.address) continue;
    realWallets.set(position.chatId, wallet);
    try {
      const state = await getUserState(wallet.address);
      exchangePositions.set(
        wallet.address,
        state.assetPositions.map((ap) => ap.position)
      );
    } catch (err) {
      console.error(`[PositionMonitor] HL state fetch failed for ${wallet.address}:`, err);
    }
  }

  for (const position of positions) {
    try {
      const now = Date.now();
      const currentPrice = await getHlPrice(coinFromSymbol(position.symbol));

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        console.warn(
          `[PositionMonitor] Skipping ${position.symbol} (chat ${position.chatId}): invalid price ${currentPrice}`
        );
        continue;
      }

      const timerExpired =
        position.timerExpiresAt !== null && now >= position.timerExpiresAt;

      const realWallet =
        position.accountMode === 'real' ? realWallets.get(position.chatId) : undefined;
      const exchangeOpen = realWallet ? exchangePositions.get(realWallet.address) : undefined;
      const coin = coinFromSymbol(position.symbol);
      const realHlPos = exchangeOpen?.find((p) => p.coin === coin) ?? null;

      if (position.accountMode === 'real' && exchangeOpen && !realHlPos) {
        console.log(
          `[PositionMonitor] Real ${position.symbol} is no longer open on Hyperliquid (chat ${position.chatId}) — closing & notifying.`
        );
        const { result } = await closePositionRecord(
          position.id!,
          position.chatId,
          'Ended..'
        );
        const text = buildClosedPositionText(position, result, true);
        await notifyPositionClosed(bot, position, text, true);
        continue;
      }

      if (!position.partialTpHit && !timerExpired) {
        const partialTpTriggered = isPartialTpTriggered(
          position.direction,
          position.entryPrice,
          currentPrice,
          position.leverage
        );

        if (partialTpTriggered) {
          if (position.accountMode === 'real') {
            await closePartialRealPosition(position);
          } else {
            const user = await getUser(position.chatId);
            if (user) {
              const realized = position.allocatedAmount;
              const newBalance = user.usdtBalance + realized;
              await updateUserBalance(position.chatId, newBalance);
            }
          }

          const newStopLoss = null;
          await updatePositionPartialTp(
            position.id!,
            newStopLoss,
            position.targetProfit
          );
          position.partialTpHit = true;
          position.stopLoss = newStopLoss;

          await logPerformance({
            chatId: position.chatId,
            strategyName: position.strategyName,
            symbol: position.symbol,
            direction: position.direction,
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            stopLoss: null,
            targetProfit: position.targetProfit,
            allocatedAmount: position.allocatedAmount,
            closingStatus: 'Ended',
            pnlUsdt: position.allocatedAmount / 2,
            wasProfitable: true,
          }).catch((err) => {
            console.error('logPerformance for 1st TP failed (non-fatal):', err);
          });

          const text = buildActivePositionText(position);
          try {
            await bot.telegram.editMessageText(
              position.chatId,
              position.messageId,
              undefined,
              text,
              { parse_mode: 'HTML', ...positionKeyboard(position.symbol) }
            );
          } catch {
            // Message may have been deleted
          }
          continue;
        }
      }

      const slHit = isStopLossHit(
        position.direction,
        currentPrice,
        position.stopLoss
      );

      const tpHit = isTakeProfitHit(
        position.direction,
        currentPrice,
        position.targetProfit
      );

      const liqPrice =
        realHlPos && parseFloat(realHlPos.liquidationPx) > 0
          ? parseFloat(realHlPos.liquidationPx)
          : getLiquidationPrice(
              position.direction,
              position.entryPrice,
              position.leverage
            );

      const liqHit =
        position.direction === 'LONG'
          ? currentPrice <= liqPrice
          : currentPrice >= liqPrice;

      if (!timerExpired && !liqHit && !slHit && !tpHit) continue;

      const exitPrice = liqHit
        ? liqPrice
        : currentPrice;

      const { result } = await closePositionByMessage(
        position.chatId,
        position.messageId,
        'Ended..',
        exitPrice
      );
      const text = buildClosedPositionText(position, result);

      await notifyPositionClosed(
        bot,
        position,
        text,
        position.accountMode === 'real'
      );

      if (slHit || tpHit || liqHit) {
        const next = await autoStartTrade(position.chatId, position.accountMode);
        if (next) {
          const cardText = buildActivePositionText(next);
          const msg = await bot.telegram.sendMessage(
            position.chatId,
            cardText,
            {
              parse_mode: 'HTML',
              ...positionKeyboard(next.symbol),
            }
          );
          next.messageId = msg.message_id;
          if (next.id) await setPositionMessageId(next.id, msg.message_id);
        }
      }
    } catch (error) {
      console.error(
        `Position monitor error for chat ${position.chatId}:`,
        error
      );
    }
  }
}

export function stopPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export async function refreshActivePositionCard(
  bot: Telegraf,
  chatId: number
): Promise<void> {
  const all = await getAllActivePositions();
  const positions = all.filter((p) => p.chatId === chatId);
  for (const position of positions) {
    const text = buildActivePositionText(position);
    await bot.telegram.editMessageText(
      chatId,
      position.messageId,
      undefined,
      text,
      {
        parse_mode: 'HTML',
        ...positionKeyboard(position.symbol),
      }
    );
  }
}