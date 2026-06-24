import { getDatabase } from '../database';
import type { TradeMode, UserProfile, UserStep } from '../../types';

function generateAddress(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SIM-${suffix}`;
}

export function getUser(chatId: number): UserProfile | null {
  const row = getDatabase()
    .prepare(
      `SELECT chat_id, address, usdt_balance, usdc_balance, current_step,
              last_trade_amount, last_trade_mode
       FROM users WHERE chat_id = ?`
    )
    .get(chatId) as
    | {
        chat_id: number;
        address: string;
        usdt_balance: number;
        usdc_balance: number;
        current_step: string | null;
        last_trade_amount: number | null;
        last_trade_mode: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    chatId: row.chat_id,
    address: row.address,
    usdtBalance: row.usdt_balance,
    usdcBalance: row.usdc_balance,
    currentStep: (row.current_step as UserStep) ?? null,
    lastTradeAmount: row.last_trade_amount,
    lastTradeMode: row.last_trade_mode as TradeMode | null,
  };
}

export function createUser(chatId: number, defaultBalance: number): UserProfile {
  const address = generateAddress();
  getDatabase()
    .prepare(
      `INSERT INTO users (chat_id, address, usdt_balance, usdc_balance, current_step)
       VALUES (?, ?, ?, 0.0, NULL)`
    )
    .run(chatId, address, defaultBalance);

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

export function getOrCreateUser(chatId: number, defaultBalance: number): UserProfile {
  return getUser(chatId) ?? createUser(chatId, defaultBalance);
}

export function setUserStep(chatId: number, step: UserStep): void {
  getDatabase()
    .prepare(`UPDATE users SET current_step = ? WHERE chat_id = ?`)
    .run(step, chatId);
}

export function updateUserBalance(chatId: number, usdtBalance: number): void {
  getDatabase()
    .prepare(`UPDATE users SET usdt_balance = ? WHERE chat_id = ?`)
    .run(usdtBalance, chatId);
}

export function updateUserLastTrade(
  chatId: number,
  amount: number,
  mode: TradeMode
): void {
  getDatabase()
    .prepare(
      `UPDATE users SET last_trade_amount = ?, last_trade_mode = ? WHERE chat_id = ?`
    )
    .run(amount, mode, chatId);
}
