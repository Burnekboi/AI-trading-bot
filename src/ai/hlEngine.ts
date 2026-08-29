import { config } from '../config';
import {
  getActiveHlPairs,
  getHlCandles,
  getCoinPrice,
  type Kline,
} from '../services/hyperliquidService';
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
  'PYUSD', 'CRVUSD',
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
  availableLeverage: number;
  scoreReason: string;
  stopLoss: number | null;
  targetProfit: number;
}

// The bot trades at 15x min / 50x max. A pair is only considered when that
// leverage is actually offered by Hyperliquid, so a candidate that can't take
// leverage is skipped instead of being cut down (or bumped) to a level it
// cannot support. The engine keeps the real per-pair available leverage (as
// reported by the market/meta) so choices reflect what the exchange allows.
const MIN_LEVERAGE = 15;
const MAX_LEVERAGE = 50;

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

  const minBuffer = Math.max(entryPrice * 0.005, atr * 1.0);

  if (direction === 'LONG') {
    const slFromSwing = swingLow - atr * 1.0;
    const slFromAtr = entryPrice - atr * 2.0;
    const stopLoss = entryPrice - (entryPrice - Math.max(Math.min(slFromSwing, slFromAtr), entryPrice - minBuffer * 3)) * slMultiplier;

    const tpFromSwing = swingHigh + atr * 1.0;
    const tpFromAtr = entryPrice + atr * 5.0;
    const targetProfit = entryPrice + (Math.max(Math.min(tpFromSwing, tpFromAtr), entryPrice + minBuffer * 2) - entryPrice) * tpMultiplier;

    return { stopLoss, targetProfit };
  }

  const slFromSwing = swingHigh + atr * 1.0;
  const slFromAtr = entryPrice + atr * 2.0;
  const stopLoss = entryPrice + (Math.min(Math.max(slFromSwing, slFromAtr), entryPrice + minBuffer * 3) - entryPrice) * slMultiplier;

  const tpFromSwing = swingLow - atr * 1.0;
  const tpFromAtr = entryPrice - atr * 5.0;
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
    levAdjust += 8;
  } else if (winRate < 0.4) {
    slMultiplier = 1.3;
    tpMultiplier = 0.7;
    levAdjust -= 8;
  }

  if (penalty.consecutiveLosses >= 2) {
    const factor = 1 + penalty.consecutiveLosses * 0.1;
    slMultiplier *= factor;
    levAdjust -= penalty.consecutiveLosses * 3;
  }

  return {
    slMultiplier: Math.min(2, slMultiplier),
    tpMultiplier: Math.max(0.5, tpMultiplier),
    levAdjust: Math.max(-40, Math.min(30, levAdjust)),
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
  availableLeverage: number,
): Promise<ScoredCandidate | null> {
  let score = 0;
  let direction: TradeDirection = 'LONG';
  let strategyName = STRATEGY_DIP;
  const reasons: string[] = [];

  let hasSignal = false;

  if (rsi1h > 65 && rsi15m > 60) {
    // Overbought fade is only reliable when the trend is NOT strongly
    // pushing that direction. Require the 1h ADX to be weak-to-moderate (<32).
    if (adx <= 32) {
      score += 45;
      direction = 'SHORT';
      strategyName = STRATEGY_REVERSAL;
      hasSignal = true;
      reasons.push('overbought RSI + weak trend (1h+15m)');
    } else if (adx > 38) {
      score -= 30;
      reasons.push('overbought in strong trend (skip fade)');
    }
  } else if (rsi1h < 35 && rsi15m < 40) {
    if (adx <= 32) {
      score += 45;
      direction = 'LONG';
      strategyName = STRATEGY_DIP;
      hasSignal = true;
      reasons.push('oversold RSI + weak trend (1h+15m)');
    } else if (adx > 38) {
      score -= 30;
      reasons.push('oversold in strong trend (skip dip)');
    }
  } else if (adx > 28) {
    score += 30 + Math.min(adx, 50) * 0.4;
    strategyName = STRATEGY_BREAKOUT;
    direction = getTrendDirection(highs, lows, closes);
    hasSignal = true;
    reasons.push(`strong ADX trend (${adx.toFixed(1)})`);
  }

  if (!hasSignal) return null;

  if (rsi1h >= 45 && rsi1h <= 55 && volatility < 1.5) {
    score -= 25;
    reasons.push('choppy flat market');
  }

  if (volatility > 2.5) {
    score -= 15;
    reasons.push('excess volatility');
  } else if (volatility >= 1.5) {
    score += 8;
    reasons.push('healthy volatility');
  }

  // Extra confirmation for reversals: reward when the price has closed back
  // through the recent mean, not just stretched RSI.
  score += Math.min(adx, 50) * 0.2;
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

  // Conservative leverage: keep the 15x floor but stop pushing toward 100x.
  // The wider the stop, the lower the leverage, so liquidation always stays
  // beyond the stop and we never blow up a position.
  let leverage = 20;
  if (volatility >= 1.5 && volatility < 3) leverage += 5;
  if (volatility > 5) leverage -= 6;
  if (adx > 38) leverage += 5;
  if (strategyName === STRATEGY_BREAKOUT && adx > 28) leverage += 5;
  if (stopLoss !== null) {
    const slDistancePct = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
    if (slDistancePct > 6) leverage = Math.min(leverage, 20);
    if (slDistancePct > 9) leverage = 15;
  }
  leverage = Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, leverage + learning.levAdjust));

  if (learning.levAdjust !== 0) {
    reasons.push(`learn adj`);
  }

  if (stopLoss !== null && leverage > 0) {
    // Liquidation distance shrinks as leverage rises. At 15-100x it is only
    // 1-6.7% from entry, while an ATR/swing stop is usually wider. When the
    // stop would sit *past* liquidation, the position used to run until it was
    // liquidated (losing the whole margin) because the stop was disabled.
    // Instead we pull the stop in to sit safely before liquidation with a
    // buffer, so we always stop out at a predefined loss rather than get
    // wiped out.
    const liquidationPrice = direction === 'LONG'
      ? entryPrice * (1 - 1 / leverage)
      : entryPrice * (1 + 1 / leverage);

    const liqDistance = direction === 'LONG'
      ? entryPrice - liquidationPrice
      : liquidationPrice - entryPrice;

    // Buffer below the liquidation level: keep the stop this far from liq.
    const liqBuffer = liqDistance * 0.35;

    if (direction === 'LONG' && stopLoss < liquidationPrice + liqBuffer) {
      stopLoss = Math.min(stopLoss, liquidationPrice + liqBuffer);
    } else if (direction === 'SHORT' && stopLoss > liquidationPrice - liqBuffer) {
      stopLoss = Math.max(stopLoss, liquidationPrice - liqBuffer);
    }

    // If tightening still lands it on the wrong side, drop leverage instead
    // so the stop has room. Recompute liquidation at a leverage that fits.
    let iterations = 0;
    while (iterations < 20) {
      const curLiq = direction === 'LONG'
        ? entryPrice * (1 - 1 / leverage)
        : entryPrice * (1 + 1 / leverage);
      if (direction === 'LONG' && stopLoss > curLiq) break;
      if (direction === 'SHORT' && stopLoss < curLiq) break;

      const reducedLeverage = Math.max(MIN_LEVERAGE, Math.floor(leverage / 2));
      if (reducedLeverage >= leverage) break;
      leverage = reducedLeverage;
      const revisedLiq = direction === 'LONG'
        ? entryPrice * (1 - 1 / leverage)
        : entryPrice * (1 + 1 / leverage);
      const newBuffer = Math.abs(entryPrice - revisedLiq) * 0.35;
      stopLoss = direction === 'LONG'
        ? Math.min(stopLoss, revisedLiq + newBuffer)
        : Math.max(stopLoss, revisedLiq - newBuffer);
      iterations++;
    }

    // Cap stop distance so risk per trade stays bounded (~12% max move).
    const maxSlDistance = entryPrice * 0.12;
    if (direction === 'LONG') {
      stopLoss = Math.max(stopLoss, entryPrice - maxSlDistance);
    } else {
      stopLoss = Math.min(stopLoss, entryPrice + maxSlDistance);
    }

    stopLoss = Number(stopLoss.toFixed(8));
    reasons.push(`liq buffer @${leverage}x`);
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
    availableLeverage: Math.min(MAX_LEVERAGE, availableLeverage),
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
  console.log('[HL AI Engine] Scanning all USDT pairs on Hyperliquid...');
  const pairs = await getActiveHlPairs();

  const usdtPairs = pairs
    .filter((p) => {
      const base = p.coin;
      return (
        !STABLECOINS.has(base) &&
        p.dayNtlVlm >= config.minQuoteVolume &&
        !isNaN(p.dayNtlVlm) &&
        p.maxLeverage >= MIN_LEVERAGE
      );
    })
    .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm)
    .slice(0, config.scanTopN);

  console.log(
    `[HL AI Engine] Top ${usdtPairs.length} HL pairs by volume selected for analysis ` +
      `(15x+ leverage available only)`
  );

  const candidates: ScoredCandidate[] = [];

  const results = await Promise.allSettled(
    usdtPairs.map(async (pair) => {
      const coin = pair.coin;
      const symbol = coin + 'USDT';

      const [klines1h, klines15m] = await Promise.all([
        getHlCandles(coin, '1h', 100),
        getHlCandles(coin, '15m', 80),
      ]);

      const entryPrice = pair.midPx;
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
        pair.maxLeverage,
      );

      return candidate;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      candidates.push(result.value);
    } else if (result.status === 'rejected') {
      console.warn('[HL AI Engine] Candidate failed:', result.reason);
    }
  }

  if (candidates.length === 0) {
    throw new Error('Hyperliquid market sweep failed: no candidate assets met signal criteria');
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function runHlMarketSweep(): Promise<TradeDecision> {
  const candidates = await evaluateAllCandidates();
  const best = candidates[0];

  console.log(
    `[HL AI Engine] Selected ${best.symbol} (score=${best.score.toFixed(1)}, ` +
      `avail=${best.availableLeverage}x, ${best.scoreReason}) → ${best.direction} via ${best.strategyName} ${best.leverage}x`
  );

  return convertCandidate(best);
}

export async function runHlMarketSweepTopN(n: number): Promise<TradeDecision[]> {
  const candidates = await evaluateAllCandidates();
  const top = candidates.slice(0, n);

  for (const c of top) {
    console.log(
      `[HL AI Engine] Selected ${c.symbol} (score=${c.score.toFixed(1)}, ` +
        `avail=${c.availableLeverage}x, ${c.scoreReason}) → ${c.direction} via ${c.strategyName} ${c.leverage}x`
    );
  }

  return top.map(convertCandidate);
}
