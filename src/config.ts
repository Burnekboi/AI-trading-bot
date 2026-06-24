import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  botToken: requireEnv('BOT_TOKEN'),
  mexcApiBase: process.env.MEXC_API_BASE ?? 'https://api.mexc.com/api/v3',
  leverage: Number(process.env.LEVERAGE ?? 10),
  defaultBalance: Number(process.env.DEFAULT_BALANCE ?? 100),
  positionPollIntervalMs: Number(process.env.POSITION_POLL_INTERVAL_MS ?? 5000),
  scanTopN: Number(process.env.SCAN_TOP_N ?? 30),
  minQuoteVolume: Number(process.env.MIN_QUOTE_VOLUME ?? 500_000),
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseKey: requireEnv('SUPABASE_SERVICE_KEY'),
};
