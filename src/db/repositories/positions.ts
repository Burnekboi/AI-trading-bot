import { supabase } from '../database';
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
  partial_tp_hit: boolean;
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
    partialTpHit: row.partial_tp_hit,
  };
}

export async function getPosition(positionId: number): Promise<ActivePosition | null> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('*')
    .eq('id', positionId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToPosition(data as Parameters<typeof rowToPosition>[0]);
}

export async function getPositionByMessage(chatId: number, messageId: number): Promise<ActivePosition | null> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('message_id', messageId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToPosition(data as Parameters<typeof rowToPosition>[0]);
}

export async function getUserPositions(chatId: number): Promise<ActivePosition[]> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('*')
    .eq('chat_id', chatId);

  if (error || !data) return [];
  return (data as Array<Parameters<typeof rowToPosition>[0]>).map(rowToPosition);
}

export async function getAllActivePositions(): Promise<ActivePosition[]> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('*');

  if (error || !data) return [];
  return (data as Array<Parameters<typeof rowToPosition>[0]>).map(rowToPosition);
}

export async function createPosition(position: ActivePosition): Promise<number> {
  const { data, error } = await supabase
    .from('active_positions')
    .insert({
      chat_id: position.chatId,
      message_id: position.messageId,
      symbol: position.symbol,
      direction: position.direction,
      allocated_amount: position.allocatedAmount,
      entry_price: position.entryPrice,
      stop_loss: position.stopLoss,
      target_profit: position.targetProfit,
      leverage: position.leverage,
      strategy_name: position.strategyName,
      timer_expires_at: position.timerExpiresAt,
      partial_tp_hit: position.partialTpHit,
    })
    .select('id')
    .single();

  if (error) throw error;
  position.id = data.id;
  return data.id;
}

export async function updatePositionMessageId(positionId: number, messageId: number): Promise<void> {
  const { error } = await supabase
    .from('active_positions')
    .update({ message_id: messageId })
    .eq('id', positionId);

  if (error) throw error;
}

export async function updatePositionPartialTp(
  positionId: number,
  stopLoss: number | null,
  targetProfit: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('active_positions')
    .update({
      stop_loss: stopLoss,
      target_profit: targetProfit,
      partial_tp_hit: true,
    })
    .eq('id', positionId);

  if (error) throw error;
}

export async function deletePosition(positionId: number): Promise<void> {
  const { error } = await supabase
    .from('active_positions')
    .delete()
    .eq('id', positionId);

  if (error) throw error;
}

export async function getUserAllocatedTotal(chatId: number): Promise<number> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('allocated_amount')
    .eq('chat_id', chatId);

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + (row.allocated_amount ?? 0), 0);
}

export async function hasActivePosition(chatId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('active_positions')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId);

  if (error || !data) return false;
  return data.length > 0;
}
