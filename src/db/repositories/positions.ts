import { getDatabase } from '../database';
import type { ActivePosition, TradeDirection } from '../../types';

function rowToPosition(row: {
  id: number;
  chat_id: number;
  message_id: number;
  symbol: string;
  direction: TradeDirection;
  allocated_amount: number;
  entry_price: number;
  stop_loss: number | null;
  target_profit: number | null;
  leverage: number;
  strategy_name: string;
  timer_expires_at: number | null;
}): ActivePosition {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    symbol: row.symbol,
    direction: row.direction,
    allocatedAmount: row.allocated_amount,
    entryPrice: row.entry_price,
    stopLoss: row.stop_loss,
    targetProfit: row.target_profit,
    leverage: row.leverage,
    strategyName: row.strategy_name,
    timerExpiresAt: row.timer_expires_at,
  };
}

const SELECT_COLS = `id, chat_id, message_id, symbol, direction, allocated_amount,
  entry_price, stop_loss, target_profit, leverage, strategy_name, timer_expires_at`;

export function getPosition(positionId: number): ActivePosition | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM active_positions WHERE id = ?`)
    .get(positionId) as Record<string, unknown> | undefined;

  return row ? rowToPosition(row as Parameters<typeof rowToPosition>[0]) : null;
}

export function getPositionByMessage(chatId: number, messageId: number): ActivePosition | null {
  const row = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM active_positions WHERE chat_id = ? AND message_id = ?`)
    .get(chatId, messageId) as Record<string, unknown> | undefined;

  return row ? rowToPosition(row as Parameters<typeof rowToPosition>[0]) : null;
}

export function getUserPositions(chatId: number): ActivePosition[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM active_positions WHERE chat_id = ?`)
    .all(chatId) as Array<Record<string, unknown>>;

  return rows.map((r) => rowToPosition(r as Parameters<typeof rowToPosition>[0]));
}

export function getAllActivePositions(): ActivePosition[] {
  const rows = getDatabase()
    .prepare(`SELECT ${SELECT_COLS} FROM active_positions`)
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => rowToPosition(r as Parameters<typeof rowToPosition>[0]));
}

export function createPosition(position: ActivePosition): number {
  const result = getDatabase()
    .prepare(
      `INSERT INTO active_positions
       (chat_id, message_id, symbol, direction, allocated_amount,
        entry_price, stop_loss, target_profit, leverage, strategy_name, timer_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      position.chatId,
      position.messageId,
      position.symbol,
      position.direction,
      position.allocatedAmount,
      position.entryPrice,
      position.stopLoss,
      position.targetProfit,
      position.leverage,
      position.strategyName,
      position.timerExpiresAt
    );

  const id = Number(result.lastInsertRowid);
  position.id = id;
  return id;
}

export function updatePositionMessageId(positionId: number, messageId: number): void {
  getDatabase()
    .prepare(`UPDATE active_positions SET message_id = ? WHERE id = ?`)
    .run(messageId, positionId);
}

export function deletePosition(positionId: number): void {
  getDatabase()
    .prepare(`DELETE FROM active_positions WHERE id = ?`)
    .run(positionId);
}

export function getUserAllocatedTotal(chatId: number): number {
  const row = getDatabase()
    .prepare(`SELECT COALESCE(SUM(allocated_amount), 0) AS total FROM active_positions WHERE chat_id = ?`)
    .get(chatId) as { total: number };

  return row.total;
}

export function hasActivePosition(chatId: number): boolean {
  const row = getDatabase()
    .prepare(`SELECT 1 FROM active_positions WHERE chat_id = ? LIMIT 1`)
    .get(chatId);

  return !!row;
}
