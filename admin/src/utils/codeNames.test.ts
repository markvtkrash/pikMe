// Tests for rejecting code-like text as dish names (get-chain-menu): paths, file names, addresses and slugs.
import { looksLikeCodeName, sanitizeItemNames } from '../../../supabase/functions/get-chain-menu/chainMenuUtils';

describe('looksLikeCodeName', () => {
  it('flags the junk a marketing page produced: paths, slugs, file names, addresses', () => {
    for (const bad of [
      'business-type/business-typequick-service', 'customer-stories/logos/caribou-coffee', 'hp-features-images/menu-management',
      'rx-logos/mendocino-farms', 'orange-right-arrow', 'quotation-svg', 'menu_photo_2', 'logo.png', 'hero.JPG', 'menu.pdf',
      'https://example.com/menu', 'www.example.com', 'folder\\file',
    ]) {
      expect([bad, looksLikeCodeName(bad)]).toEqual([bad, true]);
    }
  });

  it('keeps real dish names: spaces, capitals, hyphens inside real names, numbers first', () => {
    for (const good of [
      'Crunchy Taco', 'Pad Thai', 'Coca-Cola', 'Mac-n-Cheese', 'Chicken Tikka Masala', 'Quarter Pounder® with Cheese',
      '7-up', '7-Up', 'Egg & Cheese Sandwich', 'Pho', 'Garlic Naan', 'taco', 'Big N\' Tasty®',
    ]) {
      expect([good, looksLikeCodeName(good)]).toEqual([good, false]);
    }
    expect(looksLikeCodeName('')).toBe(false);
    expect(looksLikeCodeName(undefined as any)).toBe(false);
  });
});

describe('sanitizeItemNames drops code-like names', () => {
  it('removes the junk and keeps the dishes, in order', () => {
    const raw = ['Classic Burger', 'customer-stories/logos/waterhouse', 'orange-right-arrow', 'French Fries', 'quotation-svg', 'Chocolate Shake'];
    expect(sanitizeItemNames(raw)).toEqual(['Classic Burger', 'French Fries', 'Chocolate Shake']);
  });

  it('returns nothing for a list that is all junk', () => {
    expect(sanitizeItemNames(['hp-features-images/loyalty', 'rx-logos/zabars', 'logo.svg'])).toEqual([]);
  });
});
