import { supabase } from './supabase';

// The owner's calls for Online Ordering (migrations 165 and 167). Each throws the server's own message, which is written to be shown to
// the owner as it is ("Confirm at least one dish and give it a price before turning on ordering").
export async function setOrderingEnabled(restaurantId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('owner_set_ordering_enabled', { p_restaurant_id: restaurantId, p_enabled: enabled });
  if (error) throw new Error(error.message);
}

export async function updateOrderingSettings(
  restaurantId: string,
  settings: { prepMinutes?: number; timezone?: string }
): Promise<void> {
  const { error } = await supabase.rpc('owner_update_ordering_settings', {
    p_restaurant_id: restaurantId,
    p_prep_minutes: settings.prepMinutes ?? null,
    p_timezone: settings.timezone ?? null,
  });
  if (error) throw new Error(error.message);
}

// cents null clears the price (the dish can no longer be ordered).
export async function setMenuItemPrice(itemId: string, cents: number | null): Promise<void> {
  const { error } = await supabase.rpc('owner_set_menu_item_price', { p_item_id: itemId, p_price_cents: cents });
  if (error) throw new Error(error.message);
}
