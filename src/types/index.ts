export type TradeDirection = 'LONG' | 'SHORT';

export type UserStep =
  | 'awaiting_trade_amount'
  | 'awaiting_limit_duration'
  | 'awaiting_limit_amount'
  | 'awaiting_pair_count'
  | null;

export type TradeMode = 'market' | 'limit';

export interface UserProfile {
  chatId: number;
  address: string;
  usdtBalance: number;
  usdcBalance: number;
  currentStep: UserStep;
  lastTradeAmount: number | null;
  lastTradeMode: TradeMode | null;
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
  stopLoss: number;
  targetProfit: number;
  leverage: number;
  exploitabilityScore: number;
  rsi: number;
  adx: number;
  volatility: number;
}

export interface ClosePositionResult {
  exitPrice: number;
  pnlUsdt: number;
  newBalance: number;
  status: 'Ended..' | 'Stopped';
}
