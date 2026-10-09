import { supabase } from './supabase';

// What the owner is told about the automatic menu build for THEIR restaurant (migration 107).
export interface MenuBuildStatus {
  status: 'needs_attention' | 'no_menu_link' | 'unreadable' | 'error';
  detail: string | null;
}

const FAILED = new Set(['needs_attention', 'no_menu_link', 'unreadable', 'error']);

// Resolves to a status only when the automatic build failed for the owner's own restaurant and it has no menu items
// of its own yet; null otherwise. A lookup problem (for example the database function is not installed yet) also
// gives null, so this message can never get in the owner's way.
export async function getMenuBuildStatus(): Promise<MenuBuildStatus | null> {
  const { data, error } = await supabase.rpc('owner_menu_build_status');
  if (error) {
    console.warn('[menuBuild] owner_menu_build_status failed, showing no message:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.status !== 'string' || !FAILED.has(row.status)) return null;
  return { status: row.status, detail: typeof row.detail === 'string' && row.detail ? row.detail : null };
}

// The owner-facing wording (kept here so the banner and the tests say the same thing).
export const MENU_BUILD_MESSAGE =
  "We couldn't build your menu automatically. Add it with a photo of your menu or by pasting the text, and customers will see it.";
