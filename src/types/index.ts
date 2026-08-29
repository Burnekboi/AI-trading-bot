export type TradeDirection = 'LONG' | 'SHORT';

export type UserStep =
  | 'awaiting_trade_amount'
  | 'awaiting_limit_duration'
  | 'awaiting_limit_amount'
  | 'awaiting_pair_count'
  | 'awaiting_wallet_pk'
  | 'awaiting_create_wallet_pin'
  | 'awaiting_import_wallet_pin'
  | 'awaiting_wallet_status_pin'
  | 'awaiting_view_main_wallet_pin'
  | 'awaiting_real_trade_amount'
  | 'awaiting_real_pair_count'
  | 'awaiting_deposit_amount'
  | null;

export type TradeMode = 'market' | 'limit';
export type AccountMode = 'simulation' | 'real';

export interface UserProfile {
  chatId: number;
  address: string;
  usdtBalance: number;
  usdcBalance: number;
  currentStep: UserStep;
  lastTradeAmount: number | null;
  lastTradeMode: TradeMode | null;
  accountMode: AccountMode;
}

export interface ActivePosition {
  id?: number;
  chatId: number;
  messageId: number;
  symbol: string;
  direction: TradeDirection;
  allocatedAmount: number;
  entryPrice: number;
  stopLoss: number | null;
  targetProfit: number | null;
  leverage: number;
  strategyName: string;
  timerExpiresAt: number | null;
  partialTpHit: boolean;
  accountMode?: AccountMode;

}

export interface PerformanceRecord {
  id?: number;
  chatId: number;
  strategyName: string;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  targetProfit: number | null;
  allocatedAmount: number;
  closingStatus: 'Ended' | 'Cancelled';
  pnlUsdt: number;
  wasProfitable: boolean;
  createdAt?: number;
}

export interface StrategyPenalty {
  strategyName: string;
  symbol: string;
  consecutiveLosses: number;
  penaltyMultiplier: number;
}

export interface TradeDecision {
  symbol: string;
  direction: TradeDirection;
  strategyName: string;
  entryPrice: number;
  stopLoss: number | null;
  targetProfit: number;
  leverage: number;
  exploitabilityScore: number;
  rsi: number;
  adx: number;
  volatility: number;
  noStopLoss?: boolean;
}

export interface ClosePositionResult {
  exitPrice: number;
  pnlUsdt: number;
  newBalance: number;
  status: 'Ended..' | 'Stopped';
}

export interface Wallet {
  id?: number;
  chatId: number;
  address: string;
  privateKey: string;
  pin: string;
  network: 'ERC20' | 'BEP20';
  apiWalletAddress?: string;
  apiWalletPrivateKey?: string;
  masterAddress?: string;
  createdAt?: number;
}

export type WalletNetwork = 'ERC20' | 'BEP20';

export interface WalletBalances {
  erc20Usdt: number;
  erc20Usdc: number;
  bep20Usdt: number;
  bep20Usdc: number;
  arbUsdc: number;
}
