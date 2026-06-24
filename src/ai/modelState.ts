import { getDatabase } from '../db/database';
import { logPerformance, getRecentPerformance } from '../db/repositories/performance';
import type { PerformanceRecord, StrategyPenalty } from '../types';

const CONSECUTIVE_LOSS_THRESHOLD = 3;
const PENALTY_PER_LOSS = 0.15;
const MIN_PENALTY_MULTIPLIER = 0.3;

export function getStrategyPenalty(
  strategyName: string,
  symbol: string
): StrategyPenalty {
  const row = getDatabase()
    .prepare(
      `SELECT strategy_name, symbol, consecutive_losses, penalty_multiplier
       FROM strategy_penalties
       WHERE strategy_name = ? AND symbol = ?`
    )
    .get(strategyName, symbol) as
    | {
        strategy_name: string;
        symbol: string;
        consecutive_losses: number;
        penalty_multiplier: number;
      }
    | undefined;

  if (!row) {
    return {
      strategyName,
      symbol,
      consecutiveLosses: 0,
      penaltyMultiplier: 1.0,
    };
  }

  return {
    strategyName: row.strategy_name,
    symbol: row.symbol,
    consecutiveLosses: row.consecutive_losses,
    penaltyMultiplier: row.penalty_multiplier,
  };
}

function upsertPenalty(
  strategyName: string,
  symbol: string,
  consecutiveLosses: number,
  penaltyMultiplier: number
): void {
  getDatabase()
    .prepare(
      `INSERT INTO strategy_penalties (strategy_name, symbol, consecutive_losses, penalty_multiplier)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(strategy_name, symbol) DO UPDATE SET
         consecutive_losses = excluded.consecutive_losses,
         penalty_multiplier = excluded.penalty_multiplier`
    )
    .run(strategyName, symbol, consecutiveLosses, penaltyMultiplier);
}

export function recordTradeOutcome(record: PerformanceRecord): void {
  logPerformance(record);

  const penalty = getStrategyPenalty(record.strategyName, record.symbol);

  if (record.wasProfitable) {
    upsertPenalty(record.strategyName, record.symbol, 0, 1.0);
    return;
  }

  const newConsecutiveLosses = penalty.consecutiveLosses + 1;
  let newMultiplier = penalty.penaltyMultiplier;

  if (newConsecutiveLosses >= CONSECUTIVE_LOSS_THRESHOLD) {
    const extraLosses = newConsecutiveLosses - CONSECUTIVE_LOSS_THRESHOLD + 1;
    newMultiplier = Math.max(
      MIN_PENALTY_MULTIPLIER,
      1.0 - extraLosses * PENALTY_PER_LOSS
    );
  }

  upsertPenalty(
    record.strategyName,
    record.symbol,
    newConsecutiveLosses,
    newMultiplier
  );
}

export function getPenaltyMultiplier(
  strategyName: string,
  symbol: string
): number {
  return getStrategyPenalty(strategyName, symbol).penaltyMultiplier;
}

export function getConsecutiveLosses(
  strategyName: string,
  symbol: string
): number {
  return getStrategyPenalty(strategyName, symbol).consecutiveLosses;
}

export function getStrategyStats(
  strategyName: string,
  symbol: string
): { recent: PerformanceRecord[]; penalty: StrategyPenalty } {
  return {
    recent: getRecentPerformance(strategyName, symbol),
    penalty: getStrategyPenalty(strategyName, symbol),
  };
}
