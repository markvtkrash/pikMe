import { supabase } from './supabase';

// What the owner is told when the daily read of THEIR menu link got no menu items (migration 117).
export interface MenuImportAlert {
  status: 'no_items' | 'needs_attention';
  link: string;
}

const SHOWN = new Set(['no_items', 'needs_attention']);

// Resolves to the alert only when the last read of the owner's own menu link ended empty or unreadable and nothing has
// cleared it since; null otherwise. A lookup problem (for example the database function is not installed yet) also gives
// null, so this alert can never get in the owner's way.
export async function getMenuImportAlert(): Promise<MenuImportAlert | null> {
  const { data, error } = await supabase.rpc('owner_menu_import_alert');
  if (error) {
    console.warn('[menuImport] owner_menu_import_alert failed, showing no alert:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !SHOWN.has(row.alert_status) || typeof row.alert_link !== 'string' || !row.alert_link) return null;
  return { status: row.alert_status, link: row.alert_link };
}

// Hides the current result. A later read that ends the same way shows the alert again.
export async function dismissMenuImportAlert(): Promise<void> {
  const { error } = await supabase.rpc('owner_dismiss_menu_import_alert');
  if (error) throw error;
}

// Help below the owner's link box (migrations 122 and 124): their own link's last read failed, or a link that worked for our
// team differs from theirs.
// suggestedLink is a link our team set that worked; null when there is none to suggest. Null overall when there is
// nothing to say, and also when the lookup fails, so this can never get in the owner's way.
export interface MenuLinkHelp {
  suggestedLink: string | null;
  // true when the last read of the owner's own link failed; false when the note is only pointing to a link that worked
  ownerLinkFailed: boolean;
}

export async function getMenuLinkHelp(): Promise<MenuLinkHelp | null> {
  const { data, error } = await supabase.rpc('owner_menu_link_help');
  if (error) {
    console.warn('[menuImport] owner_menu_link_help failed, showing no help:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const link = typeof row.suggested_link === 'string' && row.suggested_link.trim() ? row.suggested_link.trim() : null;
  return { suggestedLink: link, ownerLinkFailed: row.owner_link_failed === true };
}

