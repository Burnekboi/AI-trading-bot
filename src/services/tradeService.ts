import { runMarketSweepTopN } from '../ai/engine';
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
import type {
  ActivePosition,
  ClosePositionResult,
  TradeDecision,
  TradeDirection,
} from '../types';

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

export async function executeTrade(
  chatId: number,
  allocatedAmount: number,
  timerExpiresAt: number | null,
  decision: TradeDecision
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
  };

  return position;
}

export async function executeMultipleTrades(
  chatId: number,
  amountPerPair: number,
  count: number
): Promise<ActivePosition[]> {
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
  const heldSymbols = new Set(existingPositions.map(p => p.symbol));

  const decisions = await runMarketSweepTopN(count + heldSymbols.size);

  const freshDecisions = decisions
    .filter(d => !heldSymbols.has(d.symbol))
    .slice(0, count);

  if (freshDecisions.length === 0) {
    throw new Error('No new coin pairs available to trade.');
  }

  return freshDecisions.map((decision) => ({
    chatId,
    messageId: 0,
    symbol: decision.symbol,
    direction: decision.direction,
    allocatedAmount: amountPerPair,
    entryPrice: decision.entryPrice,
    stopLoss: decision.stopLoss,
    targetProfit: decision.targetProfit,
    leverage: decision.leverage,
    strategyName: decision.strategyName,
    timerExpiresAt: null,
    partialTpHit: false,
  }));
}

export async function autoStartTrade(
  chatId: number
): Promise<ActivePosition | null> {
  const user = await getUser(chatId);
  if (!user?.lastTradeAmount) return null;

  const amount = Math.min(user.lastTradeAmount, user.usdtBalance);
  if (amount <= 0) return null;

  const positions = await executeMultipleTrades(chatId, amount, 1);
  return positions[0] ?? null;
}

export async function savePosition(position: ActivePosition): Promise<void> {
  await createPosition(position);
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

  const user = await getUser(chatId);
  if (!user) {
    throw new Error('User not found.');
  }

  const exitPrice =
    overrideExitPrice ?? (await getCurrentPrice(position.symbol));

  const pnlUsdt = calculatePnl(
    position.direction,
    position.entryPrice,
    exitPrice,
    position.allocatedAmount,
    position.leverage
  );

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

  const newBalance = Math.max(0, user.usdtBalance + pnlUsdt);
  await updateUserBalance(chatId, newBalance);

  return {
    position,
    result: { exitPrice, pnlUsdt, newBalance, status },
  };
}
