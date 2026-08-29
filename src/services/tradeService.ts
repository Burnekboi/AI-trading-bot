import { ethers } from 'ethers';
import { runHlMarketSweepTopN } from '../ai/hlEngine';
import { recordTradeOutcome } from '../ai/modelState';
import {
  createPosition,
  deletePosition,
  getPosition,
  getPositionByMessage,
  getUserPositions,
  getUserAllocatedTotal,
  updatePositionMessageId,
} from '../db/repositories/positions';
import { getUser, updateUserBalance } from '../db/repositories/users';
import { getCurrentPrice } from '../mexc/client';
import {
  getUserUsdcBalance,
  getUserOpenPositions as getHlOpenPositions,
  getUserState,
  placeMarketOrder,
  placeLimitOrder,
  setLeverage,
  closePosition as closeHlPosition,
  getCoinPrice,
  getCoinMeta,
  symbolToHl,
  hlToSymbol,
  getAllMids,
  placeTriggerOrders,
  cancelTriggerOrdersForCoin,
} from './hyperliquidService';
import type {
  AccountMode,
  ActivePosition,
  ClosePositionResult,
  TradeDecision,
  TradeDirection,
  TradeMode,
  Wallet,
} from '../types';

const MIN_LEVERAGE = 15;

function toHlCoin(symbol: string): string {
  return symbol.replace('USDT', '').replace('USDC', '');
}

const chatTradeLocks = new Map<number, Promise<unknown>>();

async function withChatLock<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
  const previous = chatTradeLocks.get(chatId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  chatTradeLocks.set(chatId, run);
  try {
    return await run;
  } finally {
    if (chatTradeLocks.get(chatId) === run) {
      chatTradeLocks.delete(chatId);
    }
  }
}

function pickFreshDecisions(
  decisions: TradeDecision[],
  takenSymbols: Set<string>,
  count: number
): TradeDecision[] {
  const fresh: TradeDecision[] = [];
  for (const decision of decisions) {
    if (takenSymbols.has(decision.symbol)) continue;
    takenSymbols.add(decision.symbol);
    fresh.push(decision);
    if (fresh.length === count) break;
  }
  return fresh;
}

// The bot's "win guarantee" stance: on the single highest-confidence signal of
// a batch, drop the stop-loss so the position is held purely on the AI's
// conviction. Every other trade keeps its stop-loss + liquidation protection.
export function calculatePnl(
  direction: TradeDirection,
  entryPrice: number,
  exitPrice: number,
  allocatedAmount: number,
  leverage: number
): number {
  const priceChange =
    direction === 'LONG'
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

  const rawPnl = allocatedAmount * leverage * priceChange;
  return Math.max(-allocatedAmount, rawPnl);
}

export function isPartialTpTriggered(
  direction: TradeDirection,
  entryPrice: number,
  currentPrice: number,
  leverage: number
): boolean {
  if (leverage <= 0) return false;
  if (direction === 'LONG') {
    return currentPrice >= entryPrice * (1 + 1 / leverage);
  }
  return currentPrice <= entryPrice * (1 - 1 / leverage);
}

export function isStopLossHit(
  direction: TradeDirection,
  currentPrice: number,
  stopLoss: number | null
): boolean {
  if (stopLoss === null) return false;
  if (direction === 'LONG') return currentPrice <= stopLoss;
  return currentPrice >= stopLoss;
}

export function isTakeProfitHit(
  direction: TradeDirection,
  currentPrice: number,
  targetProfit: number | null
): boolean {
  if (targetProfit === null) return false;
  if (direction === 'LONG') return currentPrice >= targetProfit;
  return currentPrice <= targetProfit;
}

export function isLiquidationHit(
  direction: TradeDirection,
  entryPrice: number,
  currentPrice: number,
  leverage: number
): boolean {
  if (direction === 'LONG') {
    return currentPrice <= entryPrice * (1 - 1 / leverage);
  }
  return currentPrice >= entryPrice * (1 + 1 / leverage);
}

export function getLiquidationPrice(
  direction: TradeDirection,
  entryPrice: number,
  leverage: number
): number {
  if (direction === 'LONG') {
    return entryPrice * (1 - 1 / leverage);
  }
  return entryPrice * (1 + 1 / leverage);
}

export async function executeTrade(
  chatId: number,
  allocatedAmount: number,
  timerExpiresAt: number | null,
  decision: TradeDecision,
  accountMode?: AccountMode
): Promise<ActivePosition> {
  const position: ActivePosition = {
    chatId,
    messageId: 0,
    symbol: decision.symbol,
    direction: decision.direction,
    allocatedAmount,
    entryPrice: decision.entryPrice,
    stopLoss: decision.stopLoss,
    targetProfit: decision.targetProfit,
    leverage: decision.leverage,
    strategyName: decision.strategyName,
    timerExpiresAt,
    partialTpHit: false,
    accountMode,
  };

  return position;
}

export async function executeMultipleTrades(
  chatId: number,
  amountPerPair: number,
  count: number,
  accountMode?: AccountMode
): Promise<ActivePosition[]> {
  return withChatLock(chatId, async () => {
    const user = await getUser(chatId);
    if (!user) {
      throw new Error('User not found. Send /start first.');
    }

    const totalNeeded = amountPerPair * count;
    const allocated = await getUserAllocatedTotal(chatId);
    const available = user.usdtBalance - allocated;

    if (totalNeeded > available) {
      throw new Error(
        `Insufficient balance. Need ${totalNeeded.toFixed(2)} USDT, ` +
        `only ${available.toFixed(2)} USDT available.`
      );
    }

    const existingPositions = await getUserPositions(chatId);
    const takenSymbols = new Set(existingPositions.map(p => p.symbol));

    const decisions = await runHlMarketSweepTopN(count + takenSymbols.size);

    let freshDecisions = pickFreshDecisions(decisions, takenSymbols, count);

    if (freshDecisions.length === 0) {
      throw new Error('No new coin pairs available to trade.');
    }

    const results: ActivePosition[] = [];
    let noSlOpen = existingPositions.some((p) => p.stopLoss === null);

    for (const decision of freshDecisions) {
      const useNoSl = decision.noStopLoss === true && !noSlOpen;
      if (decision.noStopLoss === true && noSlOpen) {
        console.warn(
          `[Sim] Keeping SL on ${decision.symbol}: a no-SL position is already open`
        );
      }

      const position: ActivePosition = {
        chatId,
        messageId: 0,
        symbol: decision.symbol,
        direction: decision.direction,
        allocatedAmount: amountPerPair,
        entryPrice: decision.entryPrice,
        stopLoss: useNoSl ? null : decision.stopLoss,
        targetProfit: decision.targetProfit,
        leverage: decision.leverage,
        strategyName: decision.strategyName,
        timerExpiresAt: null,
        partialTpHit: false,
        accountMode,
      };

      await savePosition(position);
      results.push(position);
      if (useNoSl) noSlOpen = true;
    }

    return results;
  });
}

export async function executeRealMultipleTrades(
  chatId: number,
  amountPerPair: number,
  count: number,
  tradeMode: TradeMode = 'market'
): Promise<ActivePosition[]> {
  return withChatLock(chatId, async () => {
    const user = await getUser(chatId);
    if (!user) throw new Error('User not found.');

    const wallet = await (await import('../db/repositories/wallets')).getWallet(chatId);
    if (!wallet || !wallet.privateKey) throw new Error('No wallet found.');

    const hlBalance = await getUserUsdcBalance(wallet.address);
    const totalNeeded = amountPerPair * count;

    if (totalNeeded > hlBalance) {
      throw new Error(
        `Insufficient Hyperliquid balance. Need ${totalNeeded.toFixed(2)} USDC, ` +
        `only ${hlBalance.toFixed(2)} USDC available.`
      );
    }

    const existingPositions = await getUserPositions(chatId);
    const takenSymbols = new Set(existingPositions.map(p => p.symbol));

    try {
      const hlOpen = await getHlOpenPositions(wallet.address);
      for (const hlPos of hlOpen) {
        const szi = parseFloat(hlPos.szi);
        if (!isNaN(szi) && szi !== 0) {
          takenSymbols.add(hlToSymbol(hlPos.coin));
        }
      }
    } catch (err) {
      console.error('[RealTrade HL] Could not fetch open HL positions for dedupe:', err);
    }

    const decisions = await runHlMarketSweepTopN(count + takenSymbols.size);

    let freshDecisions = pickFreshDecisions(decisions, takenSymbols, count);

    if (freshDecisions.length === 0) {
      throw new Error('No new coin pairs available to trade.');
    }

    const results: ActivePosition[] = [];
    const mids = await getAllMids();

    let failed = 0;
    let noSlOpen = existingPositions.some((p) => p.stopLoss === null);

    for (const decision of freshDecisions) {
      try {
        const coin = toHlCoin(decision.symbol);
        const midPriceStr = mids[coin];
        if (!midPriceStr) throw new Error(`No mid price for ${coin}`);
        const currentPrice = parseFloat(midPriceStr);

        // The AI decides SL vs no-SL per candidate (engine). We only re-check
        // a boundedness guard here: if a no-SL position is already open, this
        // one falls back to its SL so naked exposure stays at one position.
        const useNoSl = decision.noStopLoss === true && !noSlOpen;
        if (decision.noStopLoss === true && noSlOpen) {
          console.warn(
            `[RealTrade HL] Keeping SL on ${decision.symbol}: a no-SL position is already open`
          );
        }

        // Hyperliquid caps leverage per asset (BTC 40x, most alts 20-50x).
        // Clamp the AI's choice to the exchange limit so orders don't reject,
        // but never trade below the bot's MIN_LEVERAGE floor.
        const meta = await getCoinMeta(coin);
        const maxLev = meta?.maxLeverage ?? 20;
        const effectiveLeverage = Math.min(decision.leverage, maxLev);

        if (effectiveLeverage < MIN_LEVERAGE) {
          console.warn(
            `[RealTrade HL] Skipping ${coin}: pair only allows ${maxLev}x, ` +
              `below bot minimum ${MIN_LEVERAGE}x. Finding another pair.`
          );
          continue;
        }

        const rawSize = (amountPerPair * effectiveLeverage) / currentPrice;

        const tradingKey = wallet.apiWalletPrivateKey ?? wallet.privateKey;
        const pk = tradingKey.startsWith('0x') ? tradingKey : '0x' + tradingKey;

        await setLeverage(pk, coin, effectiveLeverage, false);

        const sizeStr = rawSize.toString();
        const priceStr = currentPrice.toString();

        if (tradeMode === 'limit') {
          await placeLimitOrder(pk, coin, decision.direction === 'LONG', sizeStr, priceStr, false);
        } else {
          await placeMarketOrder(pk, coin, decision.direction === 'LONG', sizeStr, priceStr, false);
        }

        let state = await getUserState(wallet.address).catch(() => null);
        if (!state) {
          await new Promise((r) => setTimeout(r, 2000));
          state = await getUserState(wallet.address).catch(() => null);
        }
        if (!state) {
          throw new Error(
            `Could not query Hyperliquid to confirm ${coin} fill — position may be open, verify manually.`
          );
        }

        const match = state.assetPositions
          .map((ap) => ap.position)
          .find(
            (p) =>
              p.coin === coin &&
              (parseFloat(p.szi) > 0) === (decision.direction === 'LONG')
          );

        if (!match) {
          throw new Error(
            `No position found on Hyperliquid after ordering ${coin} — order did not fill, skipping.`
          );
        }

        const position: ActivePosition = {
          chatId,
          messageId: 0,
          symbol: decision.symbol,
          direction: decision.direction,
          allocatedAmount: amountPerPair,
          entryPrice: parseFloat(match.entryPx),
          stopLoss: useNoSl ? null : decision.stopLoss,
          targetProfit: decision.targetProfit,
          leverage: effectiveLeverage,
          strategyName: decision.strategyName,
          timerExpiresAt: null,
          partialTpHit: false,
          accountMode: 'real',
        };

        await savePosition(position);
        results.push(position);
        if (useNoSl) noSlOpen = true;

        if (useNoSl) {
          console.warn(
            `[RealTrade HL] ${coin} opened WITHOUT a stop loss (AI decision, confidence=${decision.exploitabilityScore.toFixed(1)})`
          );
        }

        try {
          const liqPrice = getLiquidationPrice(
            position.direction,
            position.entryPrice,
            position.leverage
          );
          const placed = await placeTriggerOrders(
            pk,
            wallet.address,
            coin,
            position.direction === 'LONG',
            position.entryPrice,
            Math.abs(parseFloat(match.szi)),
            position.stopLoss,
            position.targetProfit,
            liqPrice
          );
          if (placed.placedCount > 0) {
            console.log(
              `[RealTrade HL] TP/SL triggers placed for ${coin} (${placed.placedCount} order(s))`
            );
          } else {
            console.warn(
              `[RealTrade HL] No valid TP/SL levels for ${coin} — exchange-side protection skipped`
            );
          }
        } catch (err) {
          console.error(
            `[RealTrade HL] Failed to attach TP/SL triggers for ${coin}:`,
            err
          );
        }
      } catch (err) {
        failed++;
        console.error(`[RealTrade HL] Failed to execute ${decision.symbol}:`, err);
      }
    }

    if (results.length === 0 && failed > 0) {
      throw new Error(`All ${failed} trade execution(s) failed. No positions opened.`);
    }

    return results;
  });
}

export async function autoStartTrade(
  chatId: number,
  modeOverride?: AccountMode
): Promise<ActivePosition | null> {
  const user = await getUser(chatId);
  if (!user?.lastTradeAmount) return null;

  const mode: AccountMode = modeOverride ?? user.accountMode;

  if (mode === 'real') {
    const wallet = await (await import('../db/repositories/wallets')).getWallet(chatId);
    if (!wallet) return null;
    const hlBalance = await getUserUsdcBalance(wallet.address);
    const amount = Math.min(user.lastTradeAmount, hlBalance);
    if (amount <= 0) return null;
    const positions = await executeRealMultipleTrades(chatId, amount, 1, 'market');
    return positions[0] ?? null;
  }

  const amount = Math.min(user.lastTradeAmount, user.usdtBalance);
  if (amount <= 0) return null;

  const positions = await executeMultipleTrades(chatId, amount, 1, 'simulation');
  return positions[0] ?? null;
}

export async function savePosition(position: ActivePosition): Promise<void> {
  await createPosition(position);
}

export async function closePartialRealPosition(
  position: ActivePosition
): Promise<boolean> {
  try {
    const wallet = await (await import('../db/repositories/wallets')).getWallet(position.chatId);
    if (!wallet?.privateKey) return false;

    const coin = toHlCoin(position.symbol);
    const hlPositions = await getHlOpenPositions(wallet.address);
    const hlPos = hlPositions.find((p: any) => p.coin === coin);
    if (!hlPos) return false;

    const sizeNum = parseFloat(hlPos.szi);
    if (!Number.isFinite(sizeNum) || sizeNum === 0) return false;

    const isLong = sizeNum > 0;
    const halfSize = (Math.abs(sizeNum) / 2).toString();

    const price = await getCoinPrice(coin);
    if (!price || price <= 0) return false;

    const tradingKey = wallet.apiWalletPrivateKey ?? wallet.privateKey;
    const pk = tradingKey.startsWith('0x') ? tradingKey : '0x' + tradingKey;

    await closeHlPosition(pk, coin, halfSize, price.toString(), isLong);
    console.log(
      `[PartialTP HL] Closed half of ${position.symbol} ${position.direction} (${halfSize})`
    );
    return true;
  } catch (err) {
    console.error('[PartialTP HL] Failed to close half position:', err);
    return false;
  }
}

export async function setPositionMessageId(positionId: number, messageId: number): Promise<void> {
  await updatePositionMessageId(positionId, messageId);
}

export async function closePosition(
  chatId: number,
  status: 'Ended..' | 'Stopped',
  overrideExitPrice?: number
): Promise<{ position: ActivePosition; result: ClosePositionResult }> {
  const positions = await getUserPositions(chatId);
  if (positions.length === 0) {
    throw new Error('No active position found.');
  }

  const position = positions[positions.length - 1];
  return closePositionById(position.id!, chatId, status, overrideExitPrice);
}

export async function closePositionByMessage(
  chatId: number,
  messageId: number,
  status: 'Ended..' | 'Stopped',
  overrideExitPrice?: number
): Promise<{ position: ActivePosition; result: ClosePositionResult }> {
  const position = await getPositionByMessage(chatId, messageId);
  if (!position) {
    throw new Error('No active position found.');
  }

  return closePositionById(position.id!, chatId, status, overrideExitPrice);
}

export async function closePositionRecord(
  positionId: number,
  chatId: number,
  status: 'Ended..' | 'Stopped',
  overrideExitPrice?: number
): Promise<{ position: ActivePosition; result: ClosePositionResult }> {
  return closePositionById(positionId, chatId, status, overrideExitPrice);
}

export async function closeAllPositions(
  chatId: number,
  status: 'Ended..' | 'Stopped'
): Promise<Array<{ position: ActivePosition; result: ClosePositionResult }>> {
  const positions = await getUserPositions(chatId);
  if (positions.length === 0) {
    throw new Error('No active positions found.');
  }

  const results: Array<{ position: ActivePosition; result: ClosePositionResult }> = [];
  for (const position of positions) {
    const res = await closePositionById(position.id!, chatId, status);
    results.push(res);
  }
  return results;
}

async function closePositionById(
  positionId: number,
  chatId: number,
  status: 'Ended..' | 'Stopped',
  overrideExitPrice?: number
): Promise<{ position: ActivePosition; result: ClosePositionResult }> {
  const position = await getPosition(positionId);
  if (!position) {
    throw new Error('No active position found.');
  }

  let exitPrice = overrideExitPrice ?? 0;
  let actualPnl = 0;
  let realWallet: Wallet | null = null;

  if (position.accountMode === 'real') {
    realWallet = await (await import('../db/repositories/wallets')).getWallet(chatId);
    if (!realWallet?.privateKey) {
      throw new Error('[Close] No wallet found for real position — cannot close safely.');
    }

    const coin = toHlCoin(position.symbol);
    const hlPositions = await getHlOpenPositions(realWallet.address);
    const hlPos = hlPositions.find((p: any) => p.coin === coin);

    if (hlPos) {
      const sizeNum = parseFloat(hlPos.szi);
      const isLong = sizeNum > 0;
      const tradingKey = realWallet.apiWalletPrivateKey ?? realWallet.privateKey;
      const pk = tradingKey.startsWith('0x') ? tradingKey : '0x' + tradingKey;
      const currentPrice = await getCoinPrice(coin);

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        throw new Error(`[Close] Cannot price ${coin} — position remains open.`);
      }

      const closeSize = Math.abs(sizeNum).toString();

      await closeHlPosition(pk, coin, closeSize, currentPrice.toString(), isLong);

      exitPrice = exitPrice || currentPrice;
      actualPnl = parseFloat(hlPos.unrealizedPnl);
    } else {
      // This path must only finalize when the position is genuinely gone from
      // the exchange. getHlOpenPositions swallows API errors into an empty
      // list, so verify against a throwing state call before settling.
      const state = await getUserState(realWallet.address).catch(() => null);
      if (!state) {
        throw new Error(`[Close] Cannot verify ${coin} on Hyperliquid — position remains open.`);
      }
      const stillOpen = state.assetPositions.some((ap) => ap.position.coin === coin);
      if (stillOpen) {
        throw new Error(`[Close] ${coin} still open on Hyperliquid — position remains open.`);
      }
      actualPnl = 0;
    }

    // The position is closed (or confirmed gone) — drop any leftover
    // reduce-only TP/SL triggers so a future position on this coin never
    // inherits orders sized for the old one.
    const tradingKey = realWallet.apiWalletPrivateKey ?? realWallet.privateKey;
    const cancelPk = tradingKey.startsWith('0x') ? tradingKey : '0x' + tradingKey;
    try {
      await cancelTriggerOrdersForCoin(cancelPk, realWallet.address, coin);
    } catch (err) {
      console.error(`[Close] Could not cancel resting triggers for ${coin}:`, err);
    }
  }

  const user = await getUser(chatId);
  if (!user) {
    throw new Error('User not found.');
  }

  if (!exitPrice) {
    try {
      exitPrice = await getCoinPrice(toHlCoin(position.symbol));
    } catch (err) {
      console.error('[Close] HL price lookup failed:', err);
    }
  }

  if (!exitPrice) {
    exitPrice = await getCurrentPrice(position.symbol);
  }

  let pnlUsdt: number;

  if (position.accountMode === 'real') {
    // For real trades the exchange is the ledger: unrealizedPnl of the
    // position just before the reduce-only close is the result of this leg.
    pnlUsdt = actualPnl;
  } else if (position.partialTpHit) {
    // 1st TP already paid out allocatedAmount (margin-half + profit-half).
    // Settle only the remaining half's movement beyond the trigger level,
    // floored at the loss the remaining margin can absorb.
    const legAllocated = position.allocatedAmount / 2;
    const legPnl = calculatePnl(
      position.direction,
      position.entryPrice,
      exitPrice,
      legAllocated,
      position.leverage
    );
    pnlUsdt = Math.max(legPnl - legAllocated, -legAllocated);
  } else {
    pnlUsdt = calculatePnl(
      position.direction,
      position.entryPrice,
      exitPrice,
      position.allocatedAmount,
      position.leverage
    );
  }

  try {
    await recordTradeOutcome({
      chatId,
      strategyName: position.strategyName,
      symbol: position.symbol,
      direction: position.direction,
      entryPrice: position.entryPrice,
      exitPrice,
      stopLoss: position.stopLoss,
      targetProfit: position.targetProfit,
      allocatedAmount: position.allocatedAmount,
      closingStatus: status === 'Ended..' ? 'Ended' : 'Cancelled',
      pnlUsdt,
      wasProfitable: pnlUsdt > 0,
    });
  } catch (err) {
    console.error('recordTradeOutcome failed (non-fatal, closing anyway):', err);
  }

  await deletePosition(positionId);

  let newBalance = user.usdtBalance;

  if (position.accountMode === 'real') {
    if (realWallet) {
      newBalance = await getUserUsdcBalance(realWallet.address).catch(() => user.usdtBalance);
    }
  } else {
    newBalance = Math.max(0, user.usdtBalance + pnlUsdt);
    await updateUserBalance(chatId, newBalance);
  }

  return {
    position,
    result: { exitPrice, pnlUsdt, newBalance, status },
  };
}
