import { supabase } from '../db/database';
import { logPerformance, getRecentPerformance } from '../db/repositories/performance';
import type { PerformanceRecord, StrategyPenalty } from '../types';

const CONSECUTIVE_LOSS_THRESHOLD = 3;
const PENALTY_PER_LOSS = 0.15;
const MIN_PENALTY_MULTIPLIER = 0.3;

export async function getStrategyPenalty(
  strategyName: string,
  symbol: string
): Promise<StrategyPenalty> {
  const { data, error } = await supabase
    .from('strategy_penalties')
    .select('*')
    .eq('strategy_name', strategyName)
    .eq('symbol', symbol)
    .maybeSingle();

  if (error || !data) {
    return {
      strategyName,
      symbol,
      consecutiveLosses: 0,
      penaltyMultiplier: 1.0,
    };
  }

  return {
    strategyName: data.strategy_name,
    symbol: data.symbol,
    consecutiveLosses: data.consecutive_losses,
    penaltyMultiplier: data.penalty_multiplier,
  };
}

async function upsertPenalty(
  strategyName: string,
  symbol: string,
  consecutiveLosses: number,
  penaltyMultiplier: number
): Promise<void> {
  const { error } = await supabase.from('strategy_penalties').upsert(
    {
      strategy_name: strategyName,
      symbol,
      consecutive_losses: consecutiveLosses,
      penalty_multiplier: penaltyMultiplier,
    },
    { onConflict: 'strategy_name, symbol' }
  );

  if (error) throw error;
}

export async function recordTradeOutcome(record: PerformanceRecord): Promise<void> {
  await logPerformance(record);

  const penalty = await getStrategyPenalty(record.strategyName, record.symbol);

  if (record.wasProfitable) {
    await upsertPenalty(record.strategyName, record.symbol, 0, 1.0);
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

  await upsertPenalty(
    record.strategyName,
    record.symbol,
    newConsecutiveLosses,
    newMultiplier
  );
}

export async function getPenaltyMultiplier(
  strategyName: string,
  symbol: string
): Promise<number> {
  const penalty = await getStrategyPenalty(strategyName, symbol);
  return penalty.penaltyMultiplier;
}

export async function getConsecutiveLosses(
  strategyName: string,
  symbol: string
): Promise<number> {
  const penalty = await getStrategyPenalty(strategyName, symbol);
  return penalty.consecutiveLosses;
}

export async function getStrategyStats(
  strategyName: string,
  symbol: string
): Promise<{ recent: PerformanceRecord[]; penalty: StrategyPenalty }> {
  const [recent, penalty] = await Promise.all([
    getRecentPerformance(strategyName, symbol),
    getStrategyPenalty(strategyName, symbol),
  ]);

  return { recent, penalty };
}
