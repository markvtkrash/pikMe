// The text a person sends when they share a restaurant or a dish. Plain text for now (no link): a link that opens the app needs a website domain
// set up for it. Neutral on purpose: no health, safety or "best" claims, and a dish whose menu is not confirmed says so.
import { BRAND_NAME } from '../constants/brandTheme';

const clean = (s: string | null | undefined, max = 80): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export interface RestaurantShareInput {
  name: string;
  address?: string | null;
  cuisine?: string | null;
}

/** "Check out Magic Noodle on VektraVibe." plus the cuisine and the address when known. Empty when there is no name. */
export function restaurantShareMessage({ name, address, cuisine }: RestaurantShareInput): string {
  const n = clean(name);
  if (!n) return '';
  const lines = [`Check out ${n} on ${BRAND_NAME}.`];
  const c = clean(cuisine, 60);
  if (c) lines[0] += ` ${c}.`.replace(/\.\.$/, '.');
  const a = clean(address, 120);
  if (a) lines.push(a);
  return lines.join('\n');
}

export interface DishShareInput {
  dish: string;
  restaurantName: string;
  // false for an estimated item: the restaurant has not confirmed its menu, so the dish may not be offered
  confirmed: boolean;
}

/** "Egg Rolls at Magic Noodle, on VektraVibe." An estimated dish adds "(estimated menu)". Empty when the dish or the restaurant has no name. */
export function dishShareMessage({ dish, restaurantName, confirmed }: DishShareInput): string {
  const d = clean(dish);
  const r = clean(restaurantName);
  if (!d || !r) return '';
  return `${d} at ${r}, on ${BRAND_NAME}${confirmed ? '' : ' (estimated menu)'}.`;
}
