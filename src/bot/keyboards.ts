import { Markup } from 'telegraf';
import type { AccountMode } from '../types';

export const modeSelectKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('🧪 SIMULATION', 'start_simulation')],
  [Markup.button.callback('💵 REAL MONEY', 'start_real_money')],
]);

export const mainDashboardKeyboard = (
  hasActivePositions: boolean = false,
  currentMode: AccountMode = 'simulation'
) =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback(
      currentMode === 'simulation' ? '✅ SIMULATION' : '🧪 SIMULATION',
      'switch_to_simulation'
    ),
    Markup.button.callback(
      currentMode === 'real' ? '✅ REAL MONEY' : '💵 REAL MONEY',
      'switch_to_real'
    ),
  ],
  ...(currentMode === 'simulation' ? [
    [
      Markup.button.callback('🚀 TRADE', 'simulation_trade'),
      Markup.button.callback('⏳ LIMIT TRADE', 'trade_limit'),
    ],
    ...(hasActivePositions ? [
      [
        Markup.button.callback('🛑 STOP TRADING', 'stop_last_trading'),
        Markup.button.callback('🛑 STOP ALL', 'stop_all'),
      ],
      [
        Markup.button.callback('📊 ACTIVITY', 'open_activity'),
      ],
    ] : []),
  ] : []),
  [
    Markup.button.callback('📊 STATS', 'open_stats'),
    Markup.button.callback('📈 MARKET DATA', 'market_data'),
  ],
]);

export const statsKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('📋 List W/L', 'list_wl')],
  [Markup.button.callback('⬅️ Back', 'back_to_dashboard')],
]);

export const activityKeyboard = () =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback('⬅️ Back', 'back_to_dashboard'),
    Markup.button.callback('📋 List', 'list_activity'),
  ],
]);

export const activityListKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back', 'back_to_activity')],
]);

export const backKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back', 'back_to_dashboard')],
]);

export const positionKeyboard = (symbol: string) =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback('🛑 STOP TRADING', 'stop_trading'),
    Markup.button.callback('🛑 STOP ALL', 'stop_all'),
  ],
  [
    Markup.button.callback('📊 ACTIVITY', 'open_activity'),
  ],
  [
    Markup.button.url('📈 LIVE MARKET', `https://www.tradingview.com/chart/?symbol=${symbol}`),
  ],
]);
