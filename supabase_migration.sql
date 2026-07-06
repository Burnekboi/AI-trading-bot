-- Run this SQL in your Supabase project's SQL editor (https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new)

CREATE TABLE IF NOT EXISTS users (
  chat_id BIGINT PRIMARY KEY,
  address TEXT NOT NULL,
  usdt_balance DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  usdc_balance DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  current_step TEXT,
  last_trade_amount DOUBLE PRECISION,
  last_trade_mode TEXT
);

CREATE TABLE IF NOT EXISTS active_positions (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
  allocated_amount DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION,
  target_profit DOUBLE PRECISION,
  leverage INTEGER NOT NULL DEFAULT 10,
  strategy_name TEXT NOT NULL,
  timer_expires_at BIGINT,
  partial_tp_hit BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS performance_log (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION,
  target_profit DOUBLE PRECISION,
  pnl_usdt DOUBLE PRECISION NOT NULL,
  was_profitable INTEGER NOT NULL,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

CREATE TABLE IF NOT EXISTS strategy_penalties (
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  penalty_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  PRIMARY KEY (strategy_name, symbol)
);

-- Add new columns for activity feature (run if table already exists)
ALTER TABLE performance_log ADD COLUMN IF NOT EXISTS allocated_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE performance_log ADD COLUMN IF NOT EXISTS closing_status TEXT NOT NULL DEFAULT 'Ended' CHECK(closing_status IN ('Ended', 'Cancelled'));

-- Account mode (simulation / real money)
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_mode TEXT NOT NULL DEFAULT 'simulation' CHECK(account_mode IN ('simulation', 'real'));

-- Wallet security PIN
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pin TEXT NOT NULL DEFAULT '';

-- Real money trading: track account mode on positions
ALTER TABLE active_positions ADD COLUMN IF NOT EXISTS account_mode TEXT NOT NULL DEFAULT 'simulation' CHECK(account_mode IN ('simulation', 'real'));

-- Wallets (one per user)
CREATE TABLE IF NOT EXISTS wallets (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  private_key TEXT NOT NULL,
  pin TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'ERC20' CHECK(network IN ('ERC20', 'BEP20')),
  api_wallet_address TEXT,
  api_wallet_private_key TEXT,
  master_address TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);
