import type { Kline } from './client';

export interface IndicatorSnapshot {
  rsi: number;
  adx: number;
  volatility: number;
  lastClose: number;
}

export interface IndicatorSnapshotFull extends IndicatorSnapshot {
  atr: number;
}

function extractCloses(klines: Kline[]): number[] {
  return klines.map((k) => parseFloat(k[4]));
}

function extractHighs(klines: Kline[]): number[] {
  return klines.map((k) => parseFloat(k[2]));
}

function extractLows(klines: Kline[]): number[] {
  return klines.map((k) => parseFloat(k[3]));
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  if (highs.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }

  const slice = trs.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  if (highs.length < period * 2) return 0;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }

  const smooth = (arr: number[], len: number): number => {
    const slice = arr.slice(-len);
    return slice.reduce((s, v) => s + v, 0) / len;
  };

  const smoothedTR = smooth(tr, period);
  if (smoothedTR === 0) return 0;

  const plusDI = (smooth(plusDM, period) / smoothedTR) * 100;
  const minusDI = (smooth(minusDM, period) / smoothedTR) * 100;
  const diSum = plusDI + minusDI;

  if (diSum === 0) return 0;
  const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;
  return dx;
}

export function calculateVolatility(closes: number[], period = 20): number {
  if (closes.length < period) return 0;

  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance =
    slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  return (Math.sqrt(variance) / mean) * 100;
}

export function computeIndicators(klines: Kline[]): IndicatorSnapshot {
  const closes = extractCloses(klines);
  const highs = extractHighs(klines);
  const lows = extractLows(klines);

  return {
    rsi: calculateRSI(closes),
    adx: calculateADX(highs, lows, closes),
    volatility: calculateVolatility(closes),
    lastClose: closes[closes.length - 1] ?? 0,
  };
}

export function computeIndicatorsFull(klines: Kline[]): IndicatorSnapshotFull {
  const closes = extractCloses(klines);
  const highs = extractHighs(klines);
  const lows = extractLows(klines);

  return {
    rsi: calculateRSI(closes),
    adx: calculateADX(highs, lows, closes),
    volatility: calculateVolatility(closes),
    lastClose: closes[closes.length - 1] ?? 0,
    atr: calculateATR(highs, lows, closes),
  };
}

export function getTrendDirection(
  highs: number[],
  lows: number[],
  closes: number[]
): 'LONG' | 'SHORT' {
  const adx = calculateADX(highs, lows, closes);
  if (adx < 20) {
    return closes[closes.length - 1] >= closes[closes.length - 5] ? 'LONG' : 'SHORT';
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const recentPlus = plusDM.slice(-5).reduce((s, v) => s + v, 0);
  const recentMinus = minusDM.slice(-5).reduce((s, v) => s + v, 0);
  return recentPlus >= recentMinus ? 'LONG' : 'SHORT';
}
