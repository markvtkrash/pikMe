// The text a person sends when they share a restaurant or a dish, ending with a real link to that place
// (mkrash-web's /r/[placeId] share page -- migration 154's get_place_share_info is what answers it).
// Neutral on purpose: no health, safety or "best" claims, and a dish whose menu is not confirmed says so.
import { BRAND_NAME } from '../constants/brandTheme';

const clean = (s: string | null | undefined, max = 80): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The same domain already used in LEGAL_LINKS; '' when there is no place ID to link to (never breaks the message).
function shareLink(placeId: string | null | undefined): string {
  const id = clean(placeId, 200);
  return id ? `https://www.markvtkrash.com/r/${encodeURIComponent(id)}` : '';
}

export interface RestaurantShareInput {
  name: string;
  address?: string | null;
  cuisine?: string | null;
  placeId?: string | null;
}

/** "Check out Magic Noodle on VectraVibe." plus the cuisine, the address when known, and a link to the place. Empty when there is no name. */
export function restaurantShareMessage({ name, address, cuisine, placeId }: RestaurantShareInput): string {
  const n = clean(name);
  if (!n) return '';
  const lines = [`Check out ${n} on ${BRAND_NAME}.`];
  const c = clean(cuisine, 60);
  if (c) lines[0] += ` ${c}.`.replace(/\.\.$/, '.');
  const a = clean(address, 120);
  if (a) lines.push(a);
  const link = shareLink(placeId);
  if (link) lines.push(link);
  return lines.join('\n');
}

export interface DishShareInput {
  dish: string;
  restaurantName: string;
  // false for an estimated item: the restaurant has not confirmed its menu, so the dish may not be offered
  confirmed: boolean;
  placeId?: string | null;
}

/** "Egg Rolls at Magic Noodle, on VectraVibe." An estimated dish adds "(estimated menu)", then a link to the place. Empty when the dish or the restaurant has no name. */
export function dishShareMessage({ dish, restaurantName, confirmed, placeId }: DishShareInput): string {
  const d = clean(dish);
  const r = clean(restaurantName);
  if (!d || !r) return '';
  const line = `${d} at ${r}, on ${BRAND_NAME}${confirmed ? '' : ' (estimated menu)'}.`;
  const link = shareLink(placeId);
  return link ? `${line}\n${link}` : line;
}
