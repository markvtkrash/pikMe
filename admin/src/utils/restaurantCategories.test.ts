// Tests for the restaurant categories the nearby restaurants function attaches to every restaurant (migration 129).
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_CATALOG, guessCategories, resolveCategories, type Catalog,
} from '../../../supabase/functions/fetch-nearby-restaurants/categories';

describe('guessCategories (Google types sorted into three separate groups)', () => {
  it('keeps place type, ways to order and cuisine apart for a place with all of them', () => {
    expect(guessCategories(['cafe', 'meal_takeaway', 'meal_delivery', 'mediterranean_restaurant', 'food'])).toEqual({
      venueTypes: ['cafe'], services: ['takeaway', 'delivery'], cuisines: ['mediterranean'],
    });
  });

  it('lets a place be several place types and several cuisines', () => {
    expect(guessCategories(['bakery', 'cafe', 'italian_restaurant', 'french_restaurant'])).toEqual({
      venueTypes: ['cafe', 'bakery'], services: [], cuisines: ['italian', 'french'],
    });
  });

  it('maps several Google types to one category once', () => {
    expect(guessCategories(['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant']).cuisines).toEqual(['japanese']);
  });

  it('ignores types it does not know and falls back to Restaurant', () => {
    expect(guessCategories(['point_of_interest', 'establishment', 'food'])).toEqual({ venueTypes: ['restaurant'], services: [], cuisines: [] });
    expect(guessCategories([])).toEqual({ venueTypes: ['restaurant'], services: [], cuisines: [] });
    for (const bad of [null, undefined, 'cafe', 5, {}]) {
      expect(guessCategories(bad).venueTypes).toEqual(['restaurant']);
    }
  });

  it('does not call a bar a Restaurant as well', () => {
    expect(guessCategories(['bar']).venueTypes).toEqual(['bar']);
  });

  it('is case-insensitive about the Google type and skips non-text entries', () => {
    expect(guessCategories(['CAFE', 7, null]).venueTypes).toEqual(['cafe']);
  });

  it('follows the catalog it is given: a switched-off category is never produced', () => {
    const noCafe: Catalog = { ...DEFAULT_CATALOG, categories: DEFAULT_CATALOG.categories.filter((c) => c.key !== 'cafe') };
    expect(guessCategories(['cafe'], noCafe).venueTypes).toEqual(['restaurant']);
  });

  it('uses a mapping an admin added', () => {
    const catalog: Catalog = {
      categories: [...DEFAULT_CATALOG.categories, { key: 'brewery', grp: 'venue' }],
      map: [...DEFAULT_CATALOG.map, { google_type: 'brewery', category_key: 'brewery' }],
    };
    expect(guessCategories(['brewery', 'bar'], catalog).venueTypes).toEqual(['bar', 'brewery']);
  });
});

describe('resolveCategories (the owner wins, per group)', () => {
  const google = ['bakery', 'meal_delivery', 'italian_restaurant'];

  it("uses Google's guess when the owner has chosen nothing", () => {
    expect(resolveCategories(google, null)).toEqual({
      venueTypes: ['bakery'], services: ['delivery'], cuisines: ['italian'], ownerCategories: false,
    });
    expect(resolveCategories(google, { venue_types: null, services: null, cuisines: null }).ownerCategories).toBe(false);
  });

  it('replaces Google with the owner for the group the owner chose (Google says Bakery, owner says Coffee)', () => {
    const r = resolveCategories(google, { venue_types: ['cafe'], services: null, cuisines: null });
    expect(r.venueTypes).toEqual(['cafe']);
    expect(r.services).toEqual(['delivery']);
    expect(r.cuisines).toEqual(['italian']);
    expect(r.ownerCategories).toBe(true);
  });

  it('keeps both when the owner chose both', () => {
    expect(resolveCategories(google, { venue_types: ['cafe', 'bakery'], services: null, cuisines: null }).venueTypes).toEqual(['cafe', 'bakery']);
  });

  it('respects an owner who chose none for ways to order or cuisine', () => {
    const r = resolveCategories(google, { venue_types: ['bakery'], services: [], cuisines: [] });
    expect(r.services).toEqual([]);
    expect(r.cuisines).toEqual([]);
  });

  it('puts the owner choices in the catalog order and drops unknown or switched-off keys', () => {
    const r = resolveCategories([], { venue_types: ['bakery', 'nonsense', 'cafe'], services: ['delivery', 'takeaway'], cuisines: ['x'] });
    expect(r.venueTypes).toEqual(['cafe', 'bakery']);
    expect(r.services).toEqual(['takeaway', 'delivery']);
    expect(r.cuisines).toEqual([]);
  });

  it('falls back to the guess when none of the owner place types is active any more', () => {
    expect(resolveCategories(['bar'], { venue_types: ['nonsense'], services: null, cuisines: null }).venueTypes).toEqual(['bar']);
  });

  it('is not changed by Google types changing later: the owner choice stays', () => {
    const owner = { venue_types: ['cafe'], services: ['takeaway'], cuisines: [] as string[] };
    expect(resolveCategories(['bar', 'meal_delivery'], owner)).toMatchObject({ venueTypes: ['cafe'], services: ['takeaway'], cuisines: [] });
  });
});

describe('the built-in list matches the migration seed (so the fallback never drifts)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/129_restaurant_categories.sql'), 'utf8');

  it('has the same categories in each group', () => {
    const seeded = [...sql.matchAll(/\('([a-z_]+)', '(venue|service|cuisine)', '[^']+', \d+\)/g)].map((m) => `${m[2]}:${m[1]}`).sort();
    const builtIn = DEFAULT_CATALOG.categories.map((c) => `${c.grp}:${c.key}`).sort();
    expect(builtIn).toEqual(seeded);
  });

  it('has the same Google mappings', () => {
    const block = sql.slice(sql.indexOf('INSERT INTO public.restaurant_category_map'), sql.indexOf('-- ── 2. The owner'));
    const seeded = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const builtIn = DEFAULT_CATALOG.map.map((m) => `${m.google_type}>${m.category_key}`).sort();
    expect(builtIn).toEqual(seeded);
  });
});
