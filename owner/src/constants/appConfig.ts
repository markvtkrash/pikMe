import Constants from 'expo-constants';
import { supabase } from '../api/supabase';

// Single in-memory source of truth for every DB-backed tunable in this app
// (search radius, item limits, session timeout, etc) — populated once at
// startup (see app/_layout.tsx, which blocks rendering until this resolves,
// same pattern already used for the session/auth check) and read via the
// getters below from then on. Never re-fetched mid-session and never held
// in more than one place.
//
// EXPO_PUBLIC_CONFIG_SOURCE picks where values come from:
//   'env' (default) — this app's own .env, exactly as before this existed.
//   'db'             — the shared app_config table (one row per key),
//                      managed from the admin app's Config Management page.
// A 'db' row that's missing for a given key falls back to this app's own
// .env value automatically, so partially populating the table is safe.
const rawConfigSource = process.env.EXPO_PUBLIC_CONFIG_SOURCE;
const CONFIG_SOURCE = (rawConfigSource || 'env') as 'env' | 'db';

const dbConfigCache: Record<string, string> = {};
let hasLoaded = false;

export async function loadAppConfig(): Promise<void> {
  // A typo here (e.g. "dn" instead of "db") silently falls through to 'env'
  // behavior with no error anywhere else — this is the only place that would
  // ever surface it, so it's worth a loud warning rather than a quiet no-op.
  if (rawConfigSource !== undefined && rawConfigSource !== 'env' && rawConfigSource !== 'db') {
    console.warn(`[appConfig] EXPO_PUBLIC_CONFIG_SOURCE is set to "${rawConfigSource}", which is neither "env" nor "db" — falling back to "env" behavior.`);
  }
  console.log('[appConfig] CONFIG_SOURCE =', CONFIG_SOURCE);
  if (CONFIG_SOURCE === 'db') {
    try {
      const { data, error } = await supabase.from('app_config').select('key, value');
      if (error) throw error;
      for (const row of data ?? []) dbConfigCache[row.key] = row.value;
      console.log('[appConfig] Loaded', Object.keys(dbConfigCache).length, 'row(s) from app_config:', dbConfigCache);
    } catch (err) {
      console.error('[appConfig] Failed to load DB config, falling back to .env values:', err);
    }
  }
  hasLoaded = true;
}

export function isAppConfigLoaded(): boolean {
  return hasLoaded;
}

function getRawValue(dbKey: string, envExtraKey: string): string | undefined {
  if (CONFIG_SOURCE === 'db' && dbKey in dbConfigCache) return dbConfigCache[dbKey];
  const envValue = Constants.expoConfig?.extra?.[envExtraKey];
  return envValue !== undefined && envValue !== null ? String(envValue) : undefined;
}

export function getConfigNumber(dbKey: string, envExtraKey: string, defaultValue: number): number {
  const raw = getRawValue(dbKey, envExtraKey);
  const num = Number(raw);
  return raw !== undefined && raw !== '' && !Number.isNaN(num) ? num : defaultValue;
}
