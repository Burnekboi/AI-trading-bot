import { supabase } from '../database';
import type { PerformanceRecord } from '../../types';

export async function logPerformance(record: PerformanceRecord): Promise<void> {
  const now = Date.now();
  const payload: Record<string, unknown> = {
    chat_id: record.chatId,
    strategy_name: record.strategyName,
    symbol: record.symbol,
    direction: record.direction,
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    stop_loss: record.stopLoss,
    target_profit: record.targetProfit,
    pnl_usdt: record.pnlUsdt,
    was_profitable: record.wasProfitable ? 1 : 0,
    created_at: now,
  };

  // These columns may not exist if the ALTER TABLE migration wasn't run
  try {
    const extended = {
      ...payload,
      allocated_amount: record.allocatedAmount,
      closing_status: record.closingStatus,
    };
    const { error } = await supabase.from('performance_log').insert(extended);
    if (!error) return;
  } catch {
    // fall through to base insert
  }

  const { error } = await supabase.from('performance_log').insert(payload);
  if (error) {
    console.error('logPerformance error:', JSON.stringify(error));
  }
}

export async function getRecentPerformance(
  strategyName: string,
  symbol: string,
  limit = 5
): Promise<PerformanceRecord[]> {
  const { data, error } = await supabase
    .from('performance_log')
    .select('*')
    .eq('strategy_name', strategyName)
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    chatId: row.chat_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    direction: row.direction as PerformanceRecord['direction'],
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    targetProfit: row.target_profit,
    allocatedAmount: row.allocated_amount ?? 0,
    closingStatus: row.closing_status ?? 'Ended',
    pnlUsdt: row.pnl_usdt,
    wasProfitable: row.was_profitable === 1,
    createdAt: row.created_at,
  }));
}

export async function getUserPerformance(
  chatId: number,
  limit = 50
): Promise<PerformanceRecord[]> {
  const { data, error } = await supabase
    .from('performance_log')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    chatId: row.chat_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    direction: row.direction as PerformanceRecord['direction'],
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    targetProfit: row.target_profit,
    allocatedAmount: row.allocated_amount ?? 0,
    closingStatus: row.closing_status ?? 'Ended',
    pnlUsdt: row.pnl_usdt,
    wasProfitable: row.was_profitable === 1,
    createdAt: row.created_at,
  }));
}
