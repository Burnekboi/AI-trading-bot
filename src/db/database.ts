import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  chat_id INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  usdt_balance REAL NOT NULL DEFAULT 100.0,
  usdc_balance REAL NOT NULL DEFAULT 0.0,
  current_step TEXT
);

CREATE TABLE IF NOT EXISTS active_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
  allocated_amount REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  target_profit REAL,
  leverage INTEGER NOT NULL DEFAULT 10,
  strategy_name TEXT NOT NULL,
  timer_expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS performance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl_usdt REAL NOT NULL,
  was_profitable INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE TABLE IF NOT EXISTS strategy_penalties (
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  penalty_multiplier REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (strategy_name, symbol)
);
`;

export function getDatabase(): DatabaseSync {
  if (db) return db;

  const dbPath = path.resolve(config.databasePath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  try {
    db.exec('ALTER TABLE users ADD COLUMN last_trade_amount REAL');
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE users ADD COLUMN last_trade_mode TEXT');
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE performance_log ADD COLUMN chat_id INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE performance_log ADD COLUMN stop_loss REAL');
  } catch {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE performance_log ADD COLUMN target_profit REAL');
  } catch {
    // Column already exists
  }

  const cols = db.prepare("PRAGMA table_info(active_positions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'id')) {
    db.exec(`
      CREATE TABLE active_positions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
        allocated_amount REAL NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL,
        target_profit REAL,
        leverage INTEGER NOT NULL DEFAULT 10,
        strategy_name TEXT NOT NULL,
        timer_expires_at INTEGER
      )
    `);
    db.exec(`
      INSERT INTO active_positions_new (chat_id, message_id, symbol, direction,
        allocated_amount, entry_price, stop_loss, target_profit, leverage, strategy_name, timer_expires_at)
      SELECT chat_id, message_id, symbol, direction,
        allocated_amount, entry_price, stop_loss,
        COALESCE(target_profit, NULL), COALESCE(leverage, 10), strategy_name, timer_expires_at
      FROM active_positions
    `);
    db.exec('DROP TABLE active_positions');
    db.exec('ALTER TABLE active_positions_new RENAME TO active_positions');
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
