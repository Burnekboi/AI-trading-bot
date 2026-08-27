import { Telegraf } from 'telegraf';
import { config } from '../config';
import { getAllActivePositions } from '../db/repositories/positions';
import { getCoinPrice as getHlPrice } from './hyperliquidService';
import {
  closePositionByMessage,
  closePartialRealPosition,
  isStopLossHit,
  isTakeProfitHit,
  isPartialTpTriggered,
  isLiquidationHit,
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

async function runMonitorTick(bot: Telegraf): Promise<void> {
  const positions = await getAllActivePositions();

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

        if (!position.partialTpHit && !timerExpired) {
          const partialTpTriggered = isPartialTpTriggered(
            position.direction,
            position.entryPrice,
            currentPrice,
            position.leverage
          );

          if (partialTpTriggered) {
            // Realize the 1st TP:
            // - real: close half of the position on Hyperliquid
            // - sim: credit allocatedAmount (margin-half + profit-half) to balance
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

        const liqPrice = getLiquidationPrice(
          position.direction,
          position.entryPrice,
          position.leverage
        );

        const liqHit = isLiquidationHit(
          position.direction,
          position.entryPrice,
          currentPrice,
          position.leverage
        );

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

        try {
          await bot.telegram.editMessageText(
            position.chatId,
            position.messageId,
            undefined,
            text,
            { parse_mode: 'HTML' }
          );
        } catch {
          // Message may have been deleted
        }

        if (slHit || tpHit || liqHit) {
          const next = await autoStartTrade(position.chatId);
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
