import axios, { AxiosError } from 'axios';
import { config } from '../config';

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
}

export type Kline = [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  closeTime: number,
  quoteVolume: string,
];

const client = axios.create({
  baseURL: config.mexcApiBase,
  timeout: 15_000,
});

const INTERVAL_ALIASES: Record<string, string> = {
  '1h': '60m',
  '1hour': '60m',
  '1hr': '60m',
  '1hours': '60m',
};

function normalizeInterval(interval: string): string {
  const key = interval.trim().toLowerCase();
  return INTERVAL_ALIASES[key] ?? interval;
}

function handleAxiosError(error: unknown, context: string): never {
  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED') {
      throw new Error(`${context}: MEXC API request timed out`);
    }
    const status = error.response?.status;
    const detail = error.response?.data;
    const detailText =
      detail && typeof detail === 'object' && 'msg' in detail
        ? `: ${String((detail as { msg: unknown }).msg)}`
        : '';
    throw new Error(`${context}: MEXC API error${status ? ` (${status})` : ''}${detailText}`);
  }
  throw error;
}

export async function getTicker24h(symbol: string): Promise<Ticker24h> {
  try {
    const { data } = await client.get<Ticker24h>('/ticker/24hr', {
      params: { symbol },
    });
    return data;
  } catch (error) {
    handleAxiosError(error, `getTicker24h(${symbol})`);
  }
}

export async function getAllTickers24h(): Promise<Ticker24h[]> {
  try {
    const { data } = await client.get<Ticker24h[]>('/ticker/24hr');
    return data;
  } catch (error) {
    handleAxiosError(error, 'getAllTickers24h');
  }
}

export async function getKlines(
  symbol: string,
  interval = '60m',
  limit = 100
): Promise<Kline[]> {
  try {
    const { data } = await client.get<Kline[]>('/klines', {
      params: { symbol, interval: normalizeInterval(interval), limit },
    });
    return data;
  } catch (error) {
    handleAxiosError(error, `getKlines(${symbol})`);
  }
}

export async function getCurrentPrice(symbol: string): Promise<number> {
  const ticker = await getTicker24h(symbol);
  const price = parseFloat(ticker.lastPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price for ${symbol}: ${ticker.lastPrice}`);
  }
  return price;
}

export async function getBatchTickers(symbols: readonly string[]): Promise<Ticker24h[]> {
  const results = await Promise.allSettled(
    symbols.map((symbol) => getTicker24h(symbol))
  );

  const tickers: Ticker24h[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      tickers.push(result.value);
    } else {
      console.warn(`Failed to fetch ticker for ${symbols[i]}:`, result.reason);
    }
  }
  return tickers;
}
