import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey);

  type TableConfig = { name: string; key: string; isNumeric: boolean };
  const tables: TableConfig[] = [
    { name: 'active_positions', key: 'id', isNumeric: true },
    { name: 'performance_log', key: 'id', isNumeric: true },
    { name: 'strategy_penalties', key: 'strategy_name', isNumeric: false },
    { name: 'users', key: 'chat_id', isNumeric: true },
  ];

  for (const { name, key, isNumeric } of tables) {
    const filterValue = isNumeric ? -1 : '__DELETE_ALL__';
    const { error } = await supabase.from(name).delete().neq(key, filterValue);
    if (error && error.code !== 'PGRST116') {
      console.error(`Error deleting from ${name}:`, error.message);
    } else {
      console.log(`Cleared table: ${name}`);
    }
  }

  // Remove local SQLite file if it exists
  const dbPath = path.resolve(__dirname, '..', 'data', 'simulator.db');
  for (const ext of ['.db', '.db-shm', '.db-wal']) {
    const file = dbPath.replace(/\.db$/, ext);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`Removed: ${file}`);
    }
  }

  console.log('Database reset complete.');
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
