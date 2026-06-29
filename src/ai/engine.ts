import { config } from '../config';
import { getAllTickers24h, getKlines } from '../mexc/client';
import {
  computeIndicatorsFull,
  getTrendDirection,
} from '../mexc/indicators';
import { getPenaltyMultiplier, getStrategyStats } from './modelState';
import type { TradeDecision, TradeDirection } from '../types';

const STRATEGY_REVERSAL = 'AI Reversal Exhaustion Strategy';
const STRATEGY_DIP = 'AI Institutional Liquidity Dip Strategy';
const STRATEGY_BREAKOUT = 'AI High-Velocity Breakout Strategy';

const STABLECOINS = new Set([
  'USDC', 'USDD', 'DAI', 'BUSD', 'TUSD', 'FDUSD',
  'USDJ', 'HUSD', 'GUSD', 'PAX', 'SUSD', 'MIM',
  'FRAX', 'LUSD', 'DOLA', 'USDP', 'USTC',
  'EURS', 'EURT', 'EURC', 'EURI',
]);

interface ScoredCandidate {
  symbol: string;
  score: number;
  rsi: number;
  adx: number;
  volatility: number;
  entryPrice: number;
  direction: TradeDirection;
  strategyName: string;
  leverage: number;
  scoreReason: string;
  stopLoss: number | null;
  targetProfit: number;
}

function findDynamicSLTP(
  highs: number[],
  lows: number[],
  atr: number,
  direction: TradeDirection,
  entryPrice: number,
  slMultiplier = 1,
  tpMultiplier = 1,
): { stopLoss: number; targetProfit: number } {
  const lookback = 20;
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);

  // Swing trade buffer: wider to avoid premature stop-outs
  const minBuffer = Math.max(entryPrice * 0.005, atr * 1.0);

  if (direction === 'LONG') {
    // SL candidates (both should be below entry)
    const slFromSwing = swingLow - atr * 1.0;
    const slFromAtr = entryPrice - atr * 2.0;
    // Pick the safer stop (further from entry) for swing trading
    const stopLoss = entryPrice - (entryPrice - Math.max(Math.min(slFromSwing, slFromAtr), entryPrice - minBuffer * 3)) * slMultiplier;

    // TP candidates (both should be above entry)
    const tpFromSwing = swingHigh + atr * 1.0;
    const tpFromAtr = entryPrice + atr * 5.0;
    // Pick the tighter TP (closer to entry) for reliable profit-taking
    const targetProfit = entryPrice + (Math.max(Math.min(tpFromSwing, tpFromAtr), entryPrice + minBuffer * 2) - entryPrice) * tpMultiplier;

    return { stopLoss, targetProfit };
  }

  // SHORT
  // SL candidates (both should be above entry)
  const slFromSwing = swingHigh + atr * 1.0;
  const slFromAtr = entryPrice + atr * 2.0;
  // Pick the safer stop (further from entry) for swing trading
  const stopLoss = entryPrice + (Math.min(Math.max(slFromSwing, slFromAtr), entryPrice + minBuffer * 3) - entryPrice) * slMultiplier;

  // TP candidates (both should be below entry)
  const tpFromSwing = swingLow - atr * 1.0;
  const tpFromAtr = entryPrice - atr * 5.0;
  // Pick the tighter TP (closer to entry) for reliable profit-taking
  const targetProfit = entryPrice - (entryPrice - Math.min(Math.max(tpFromSwing, tpFromAtr), entryPrice - minBuffer * 2)) * tpMultiplier;

  return { stopLoss, targetProfit };
}

async function getLearnedAdjustments(
  strategyName: string,
  symbol: string
): Promise<{ slMultiplier: number; tpMultiplier: number; levAdjust: number }> {
  const stats = await getStrategyStats(strategyName, symbol);
  const { recent, penalty } = stats;

  if (recent.length === 0) {
    return { slMultiplier: 1, tpMultiplier: 1, levAdjust: 0 };
  }

  const wins = recent.filter((r) => r.wasProfitable).length;
  const winRate = wins / recent.length;

  let slMultiplier = 1;
  let tpMultiplier = 1;
  let levAdjust = 0;

  if (winRate > 0.6) {
    slMultiplier = 0.8;
    tpMultiplier = 1.3;
    levAdjust += 2;
  } else if (winRate < 0.4) {
    slMultiplier = 1.3;
    tpMultiplier = 0.7;
    levAdjust -= 2;
  }

  if (penalty.consecutiveLosses >= 2) {
    const factor = 1 + penalty.consecutiveLosses * 0.1;
    slMultiplier *= factor;
    levAdjust -= penalty.consecutiveLosses;
  }

  return {
    slMultiplier: Math.min(2, slMultiplier),
    tpMultiplier: Math.max(0.5, tpMultiplier),
    levAdjust: Math.max(-8, Math.min(6, levAdjust)),
  };
}

async function scoreCandidate(
  symbol: string,
  rsi1h: number,
  rsi15m: number,
  adx: number,
  volatility: number,
  entryPrice: number,
  lows: number[],
  highs: number[],
  atr: number,
  closes: number[],
): Promise<ScoredCandidate | null> {
  let score = 0;
  let direction: TradeDirection = 'LONG';
  let strategyName = STRATEGY_DIP;
  const reasons: string[] = [];

  let hasSignal = false;

  if (rsi1h > 65 && rsi15m > 60) {
    score += 40;
    direction = 'SHORT';
    strategyName = STRATEGY_REVERSAL;
    hasSignal = true;
    reasons.push('overbought RSI (1h+15m)');
  } else if (rsi1h < 35 && rsi15m < 40) {
    score += 40;
    direction = 'LONG';
    strategyName = STRATEGY_DIP;
    hasSignal = true;
    reasons.push('oversold RSI (1h+15m)');
  } else if (adx > 28) {
    score += 35;
    strategyName = STRATEGY_BREAKOUT;
    direction = getTrendDirection(highs, lows, closes);
    hasSignal = true;
    reasons.push('strong ADX trend');
  }

  if (!hasSignal) return null;

  if (rsi1h >= 45 && rsi1h <= 55 && volatility < 1.5) {
    score -= 25;
    reasons.push('choppy flat market');
  }

  if (volatility > 2) {
    score += 10;
    reasons.push('elevated volatility');
  }

  score += Math.min(adx, 50) * 0.3;
  score += Math.abs(rsi1h - 50) * 0.4;

  const penalty = await getPenaltyMultiplier(strategyName, symbol);
  score *= penalty;

  if (penalty < 1) {
    reasons.push(`penalty x${penalty.toFixed(2)}`);
  }

  const learning = await getLearnedAdjustments(strategyName, symbol);

  const { stopLoss: rawSL, targetProfit } = findDynamicSLTP(
    highs, lows, atr, direction, entryPrice,
    learning.slMultiplier, learning.tpMultiplier,
  );
  let stopLoss: number | null = rawSL;

  let leverage = 10;
  if (volatility < 1.5) leverage += 3;
  if (volatility > 3) leverage -= 2;
  if (volatility > 5) leverage -= 3;
  if (adx > 28) leverage += 3;
  if (adx > 40) leverage += 2;
  if (rsi1h > 70 || rsi1h < 30) leverage += 2;
  leverage = Math.max(3, Math.min(20, leverage + learning.levAdjust));

  if (learning.levAdjust !== 0) {
    reasons.push(`learn adj`);
  }

  if (stopLoss !== null && leverage > 0) {
    const liquidationPrice = direction === 'LONG'
      ? entryPrice * (1 - 1 / leverage)
      : entryPrice * (1 + 1 / leverage);

    const unreachable = direction === 'LONG'
      ? stopLoss < liquidationPrice
      : stopLoss > liquidationPrice;

    if (unreachable) {
      stopLoss = null;
      reasons.push('no SL (past liq)');
    }
  }

  return {
    symbol,
    score,
    rsi: rsi1h,
    adx,
    volatility,
    entryPrice,
    direction,
    strategyName,
    leverage,
    scoreReason: reasons.join(', ') || 'baseline',
    stopLoss,
    targetProfit,
  };
}

function convertCandidate(c: ScoredCandidate): TradeDecision {
  return {
    symbol: c.symbol,
    direction: c.direction,
    strategyName: c.strategyName,
    entryPrice: c.entryPrice,
    stopLoss: c.stopLoss,
    targetProfit: c.targetProfit,
    leverage: c.leverage,
    exploitabilityScore: c.score,
    rsi: c.rsi,
    adx: c.adx,
    volatility: c.volatility,
  };
}

async function evaluateAllCandidates(): Promise<ScoredCandidate[]> {
  console.log('[AI Engine] Scanning all USDT pairs on MEXC...');
  const allTickers = await getAllTickers24h();

  const usdtPairs = allTickers
    .filter((t) => {
      const qv = parseFloat(t.quoteVolume);
      const base = t.symbol.replace(/USDT$/, '');
      return t.symbol.endsWith('USDT') && !STABLECOINS.has(base) && qv >= config.minQuoteVolume && !isNaN(qv);
    })
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, config.scanTopN);

  console.log(`[AI Engine] Top ${usdtPairs.length} USDT pairs by volume selected for analysis`);

  const candidates: ScoredCandidate[] = [];

  const results = await Promise.allSettled(
    usdtPairs.map(async (ticker) => {
      const symbol = ticker.symbol;

      const [klines1h, klines15m] = await Promise.all([
        getKlines(symbol, '60m', 100),
        getKlines(symbol, '15m', 80),
      ]);

      const entryPrice = parseFloat(ticker.lastPrice);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

      const ind1h = computeIndicatorsFull(klines1h);
      const ind15mRsi = computeIndicatorsFull(klines15m).rsi;

      const highs = klines1h.map((k) => parseFloat(k[2]));
      const lows = klines1h.map((k) => parseFloat(k[3]));
      const closes = klines1h.map((k) => parseFloat(k[4]));

      const candidate = await scoreCandidate(
        symbol,
        ind1h.rsi,
        ind15mRsi,
        ind1h.adx,
        ind1h.volatility,
        entryPrice,
        lows,
        highs,
        ind1h.atr,
        closes,
      );

      return candidate;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      candidates.push(result.value);
    } else if (result.status === 'rejected') {
      console.warn('Market sweep candidate failed:', result.reason);
    }
  }

  if (candidates.length === 0) {
    throw new Error('Market sweep failed: no candidate assets met signal criteria');
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function runMarketSweep(): Promise<TradeDecision> {
  const candidates = await evaluateAllCandidates();
  const best = candidates[0];

  console.log(
    `[AI Engine] Selected ${best.symbol} (score=${best.score.toFixed(1)}, ` +
      `${best.scoreReason}) → ${best.direction} via ${best.strategyName} ${best.leverage}x`
  );

  return convertCandidate(best);
}

export async function runMarketSweepTopN(n: number): Promise<TradeDecision[]> {
  const candidates = await evaluateAllCandidates();
  const top = candidates.slice(0, n);

  for (const c of top) {
    console.log(
      `[AI Engine] Selected ${c.symbol} (score=${c.score.toFixed(1)}, ` +
        `${c.scoreReason}) → ${c.direction} via ${c.strategyName} ${c.leverage}x`
    );
  }

  return top.map(convertCandidate);
}
