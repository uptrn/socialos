import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '../env';

export function createBrowserSupabase() {
  return createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseKey());
}
