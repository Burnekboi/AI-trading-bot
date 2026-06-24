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

  return allocatedAmount * leverage * priceChange;
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
  };

  return position;
}

export async function executeMultipleTrades(
  chatId: number,
  amountPerPair: number,
  count: number
): Promise<ActivePosition[]> {
  const user = getUser(chatId);
  if (!user) {
    throw new Error('User not found. Send /start first.');
  }

  const totalNeeded = amountPerPair * count;
  const allocated = getUserAllocatedTotal(chatId);
  const available = user.usdtBalance - allocated;

  if (totalNeeded > available) {
    throw new Error(
      `Insufficient balance. Need ${totalNeeded.toFixed(2)} USDT, ` +
      `only ${available.toFixed(2)} USDT available.`
    );
  }

  const decisions = await runMarketSweepTopN(count);

  return decisions.map((decision) => ({
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
  }));
}

export async function autoStartTrade(
  chatId: number
): Promise<ActivePosition | null> {
  const user = getUser(chatId);
  if (!user?.lastTradeAmount) return null;

  const amount = Math.min(user.lastTradeAmount, user.usdtBalance);
  if (amount <= 0) return null;

  const positions = await executeMultipleTrades(chatId, amount, 1);
  return positions[0] ?? null;
}

export function savePosition(position: ActivePosition): void {
  createPosition(position);
}

export function setPositionMessageId(positionId: number, messageId: number): void {
  updatePositionMessageId(positionId, messageId);
}

export async function closePosition(
  chatId: number,
  status: 'Ended..' | 'Stopped',
  overrideExitPrice?: number
): Promise<{ position: ActivePosition; result: ClosePositionResult }> {
  const positions = getUserPositions(chatId);
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
  const position = getPositionByMessage(chatId, messageId);
  if (!position) {
    throw new Error('No active position found.');
  }

  return closePositionById(position.id!, chatId, status, overrideExitPrice);
}

export async function closeAllPositions(
  chatId: number,
  status: 'Ended..' | 'Stopped'
): Promise<Array<{ position: ActivePosition; result: ClosePositionResult }>> {
  const positions = getUserPositions(chatId);
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
  const position = getPosition(positionId);
  if (!position) {
    throw new Error('No active position found.');
  }

  const user = getUser(chatId);
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

  const newBalance = Math.max(0, user.usdtBalance + pnlUsdt);
  updateUserBalance(chatId, newBalance);

  recordTradeOutcome({
    chatId,
    strategyName: position.strategyName,
    symbol: position.symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    stopLoss: position.stopLoss,
    targetProfit: position.targetProfit,
    pnlUsdt,
    wasProfitable: pnlUsdt > 0,
  });

  deletePosition(positionId);

  return {
    position,
    result: { exitPrice, pnlUsdt, newBalance, status },
  };
}
