import { Markup } from 'telegraf';

export const dashboardKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('📊 Open Dashboard', 'open_dashboard')],
]);

export const mainDashboardKeyboard = (hasActivePositions: boolean = false) =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback('🚀 TRADE', 'trade_market'),
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
