import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

export async function initDatabase(): Promise<void> {
  const { error } = await supabase.from('users').select('chat_id', { count: 'exact', head: true });
  if (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
  console.log('Database connected');
}
