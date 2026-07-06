import { Markup } from 'telegraf';

export const modeSelectKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('🧪 SIMULATION', 'start_simulation')],
  [Markup.button.callback('💵 REAL MONEY', 'start_real_money')],
]);

export const mainDashboardKeyboard = (hasActivePositions: boolean = false) =>
  Markup.inlineKeyboard([
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
  [
    Markup.button.callback('📊 STATS', 'open_stats'),
    Markup.button.callback('📈 MARKET DATA', 'market_data'),
  ],
  [
    Markup.button.callback('💵 REAL MONEY', 'switch_to_real'),
  ],
]);

export const realDashboardKeyboard = (hasWallet: boolean) =>
  Markup.inlineKeyboard([
  ...(hasWallet ? [
    [
      Markup.button.callback('🚀 START TRADING', 'start_trading_real'),
      Markup.button.callback('📊 WALLET STATUS', 'wallet_status'),
    ],
  ] : [
    [
      Markup.button.callback('💼 Create Wallet', 'real_create_wallet'),
      Markup.button.callback('📥 Import Wallet', 'real_import_wallet'),
    ],
    [
      Markup.button.callback('⬅️ Back', 'real_back'),
    ],
  ]),
]);

export const walletStatusKeyboard = (hasApiWallet: boolean) =>
  Markup.inlineKeyboard([
  ...(hasApiWallet ? [
    [Markup.button.callback('👁 VIEW MAIN WALLET', 'view_main_wallet')],
  ] : [
    [Markup.button.callback('🔐 SET UP API WALLET', 'setup_api_wallet')],
  ]),
  [Markup.button.callback('⬅️ Back', 'wallet_status_back')],
]);

export const mainWalletViewKeyboard = () =>
  Markup.inlineKeyboard([
  [Markup.button.callback('🗑 DELETE WALLET', 'real_delete_wallet')],
  [Markup.button.callback('⬅️ Back', 'back_to_wallet_status')],
]);

export const createWalletKeyboard = () =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback('ERC-20 (ETH)', 'create_wallet_erc20'),
    Markup.button.callback('BEP-20 (BNB)', 'create_wallet_bep20'),
  ],
  [Markup.button.callback('⬅️ Back', 'create_wallet_back')],
]);

export const importWalletResultKeyboard = () =>
  Markup.inlineKeyboard([
  [
    Markup.button.callback('ERC-20 (ETH)', 'import_wallet_erc20'),
    Markup.button.callback('BEP-20 (BNB)', 'import_wallet_bep20'),
  ],
  [Markup.button.callback('⬅️ Back', 'import_wallet_back')],
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
