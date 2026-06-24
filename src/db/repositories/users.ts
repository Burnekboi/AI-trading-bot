import { supabase } from '../database';
import type { TradeMode, UserProfile, UserStep } from '../../types';

function generateAddress(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SIM-${suffix}`;
}

export async function getUser(chatId: number): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    chatId: data.chat_id,
    address: data.address,
    usdtBalance: data.usdt_balance,
    usdcBalance: data.usdc_balance,
    currentStep: data.current_step as UserStep | null,
    lastTradeAmount: data.last_trade_amount,
    lastTradeMode: data.last_trade_mode as TradeMode | null,
  };
}

export async function createUser(chatId: number, defaultBalance: number): Promise<UserProfile> {
  const address = generateAddress();
  const { error } = await supabase.from('users').insert({
    chat_id: chatId,
    address,
    usdt_balance: defaultBalance,
    usdc_balance: 0,
    current_step: null,
  });

  if (error) throw error;

  return {
    chatId,
    address,
    usdtBalance: defaultBalance,
    usdcBalance: 0,
    currentStep: null,
    lastTradeAmount: null,
    lastTradeMode: null,
  };
}

export async function getOrCreateUser(chatId: number, defaultBalance: number): Promise<UserProfile> {
  const existing = await getUser(chatId);
  return existing ?? createUser(chatId, defaultBalance);
}

export async function setUserStep(chatId: number, step: UserStep): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ current_step: step })
    .eq('chat_id', chatId);

  if (error) throw error;
}

export async function updateUserBalance(chatId: number, usdtBalance: number): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ usdt_balance: usdtBalance })
    .eq('chat_id', chatId);

  if (error) throw error;
}

export async function updateUserLastTrade(chatId: number, amount: number, mode: TradeMode): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ last_trade_amount: amount, last_trade_mode: mode })
    .eq('chat_id', chatId);

  if (error) throw error;
}
