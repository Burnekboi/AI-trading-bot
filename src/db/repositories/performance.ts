import { getDatabase } from '../database';
import type { PerformanceRecord } from '../../types';

export function logPerformance(record: PerformanceRecord): void {
  getDatabase()
    .prepare(
      `INSERT INTO performance_log
       (chat_id, strategy_name, symbol, direction, entry_price, exit_price, stop_loss, target_profit, pnl_usdt, was_profitable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.chatId,
      record.strategyName,
      record.symbol,
      record.direction,
      record.entryPrice,
      record.exitPrice,
      record.stopLoss,
      record.targetProfit,
      record.pnlUsdt,
      record.wasProfitable ? 1 : 0
    );
}

export function getRecentPerformance(
  strategyName: string,
  symbol: string,
  limit = 5
): PerformanceRecord[] {
  const rows = getDatabase()
    .prepare(
      `SELECT chat_id, strategy_name, symbol, direction, entry_price, exit_price,
               stop_loss, target_profit, pnl_usdt, was_profitable, created_at
        FROM performance_log
        WHERE strategy_name = ? AND symbol = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(strategyName, symbol, limit) as Array<{
    chat_id: number;
    strategy_name: string;
    symbol: string;
    direction: string;
    entry_price: number;
    exit_price: number;
    stop_loss: number | null;
    target_profit: number | null;
    pnl_usdt: number;
    was_profitable: number;
    created_at: number;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    direction: row.direction as PerformanceRecord['direction'],
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    targetProfit: row.target_profit,
    pnlUsdt: row.pnl_usdt,
    wasProfitable: row.was_profitable === 1,
    createdAt: row.created_at,
  }));
}

export function getUserPerformance(
  chatId: number,
  limit = 50
): PerformanceRecord[] {
  const rows = getDatabase()
    .prepare(
      `SELECT chat_id, strategy_name, symbol, direction, entry_price, exit_price,
               stop_loss, target_profit, pnl_usdt, was_profitable, created_at
        FROM performance_log
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(chatId, limit) as Array<{
    chat_id: number;
    strategy_name: string;
    symbol: string;
    direction: string;
    entry_price: number;
    exit_price: number;
    stop_loss: number | null;
    target_profit: number | null;
    pnl_usdt: number;
    was_profitable: number;
    created_at: number;
  }>;

  return rows.map((row) => ({
    chatId: row.chat_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    direction: row.direction as PerformanceRecord['direction'],
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    stopLoss: row.stop_loss,
    targetProfit: row.target_profit,
    pnlUsdt: row.pnl_usdt,
    wasProfitable: row.was_profitable === 1,
    createdAt: row.created_at,
  }));
}
