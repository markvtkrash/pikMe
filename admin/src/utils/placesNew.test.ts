// Tests for the Places API (New) helper of fetch-nearby-restaurants.
import {
  buildDetailsRequest, buildNearbyRequest, CHAIN_HEAVY_PRIMARY_TYPES, cityFromAddress, DETAILS_FIELD_MASK, describeGoogleError, FOOD_TYPES, MEAL_TYPES, mergePlaces,
  NEARBY_FIELD_MASK, NEW_API_MAX_CALLS, NEW_API_MAX_RESULTS, parseNearbyResponse, parsePlacesApiVersion, SEARCH_GROUPS, toLegacyHours,
  toLegacyPlace, TREAT_TYPES,
} from '../../../supabase/functions/fetch-nearby-restaurants/placesNew';

describe('parsePlacesApiVersion', () => {
  it('is new only for the exact word new, in any case', () => {
    expect(parsePlacesApiVersion('new')).toBe('new');
    expect(parsePlacesApiVersion(' NEW ')).toBe('new');
  });
  it('is legacy for everything else, so a typo or a missing value never switches anything on', () => {
    for (const v of ['legacy', '', 'neww', 'true', 'on', null, undefined, 1]) expect(parsePlacesApiVersion(v)).toBe('legacy');
  });
});

describe('the field mask', () => {
  const fields = NEARBY_FIELD_MASK.split(',');
  it('asks only for what the app uses', () => {
    expect(fields.sort()).toEqual([
      'places.businessStatus', 'places.currentOpeningHours', 'places.displayName', 'places.formattedAddress', 'places.id', 'places.location',
      'places.rating', 'places.types',
    ]);
  });
  it('never asks for the expensive or unused fields', () => {
    for (const bad of ['photos', 'reviews', 'editorialSummary', 'websiteUri', 'nationalPhoneNumber', 'priceLevel', 'priceRange', 'servesVegetarianFood', 'userRatingCount']) {
      expect(NEARBY_FIELD_MASK).not.toContain(bad);
      expect(DETAILS_FIELD_MASK).not.toContain(bad);
    }
  });
  it('the one-place mask has the same fields without the "places." prefix', () => {
    expect(DETAILS_FIELD_MASK.split(',').map((f) => `places.${f}`).sort()).toEqual(fields.sort());
  });
});

describe('buildNearbyRequest', () => {
  const { url, init } = buildNearbyRequest(37.77, -122.41, 9000, 'KEY');
  const body = JSON.parse(init.body);
  it('is a POST to searchNearby with the key and the field mask in headers, never in the address', () => {
    expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(url).not.toContain('KEY');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(init.headers['X-Goog-FieldMask']).toBe(NEARBY_FIELD_MASK);
  });
  it('asks for the 20 nearest food places inside the circle', () => {
    expect(body.maxResultCount).toBe(20);
    expect(body.rankPreference).toBe('DISTANCE');
    expect(body.includedTypes).toEqual(FOOD_TYPES);
    expect(FOOD_TYPES).toEqual(expect.arrayContaining(['restaurant', 'cafe', 'coffee_shop', 'bakery', 'fast_food_restaurant']));
    expect(body.locationRestriction.circle).toEqual({ center: { latitude: 37.77, longitude: -122.41 }, radius: 9000 });
  });
  it('keeps the radius inside what Google allows', () => {
    expect(JSON.parse(buildNearbyRequest(0, 0, 80000, 'K').init.body).locationRestriction.circle.radius).toBe(50000);
    expect(JSON.parse(buildNearbyRequest(0, 0, 0, 'K').init.body).locationRestriction.circle.radius).toBe(1);
  });
});

describe('buildDetailsRequest', () => {
  it('is a GET for one place with the field mask in a header', () => {
    const { url, init } = buildDetailsRequest('ChIJabc/def', 'KEY');
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc%2Fdef');
    expect(init.method).toBe('GET');
    expect(init.headers['X-Goog-FieldMask']).toBe(DETAILS_FIELD_MASK);
    expect(url).not.toContain('KEY');
  });
});

describe('toLegacyHours', () => {
  const hours = {
    openNow: true,
    weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM', 'Tuesday: Closed'],
    periods: [
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 30 } },
      { open: { day: 0, hour: 0, minute: 0 } },
      { close: { day: 3, hour: 1, minute: 0 } },
    ],
  };
  it('gives the legacy shape: HHMM times, the same days, open now, the weekday text', () => {
    expect(toLegacyHours(hours)).toEqual({
      open_now: true,
      weekday_text: ['Monday: 9:00 AM – 5:00 PM', 'Tuesday: Closed'],
      periods: [
        { open: { day: 1, time: '0900' }, close: { day: 1, time: '1730' } },
        { open: { day: 0, time: '0000' } },
      ],
    });
  });
  it('copes with missing parts, and with no hours at all', () => {
    expect(toLegacyHours({})).toEqual({ open_now: false, weekday_text: [], periods: [] });
    expect(toLegacyHours(undefined)).toBeUndefined();
    expect(toLegacyHours(null)).toBeUndefined();
  });
});

describe('cityFromAddress', () => {
  it('reads the city out of a US address', () => {
    expect(cityFromAddress('101 Market Street Suite 1, San Francisco, CA 94103, USA')).toBe('San Francisco');
    expect(cityFromAddress('1 Main St, Wichita, KS 67202')).toBe('Wichita');
    expect(cityFromAddress('Austin, TX, USA')).toBe('Austin');
  });
  it('gives nothing for an address in another shape', () => {
    for (const a of ['', null, undefined, 'Somewhere', '12 Rue Cler, 75007 Paris, France', '1 Main St, Springfield']) expect(cityFromAddress(a as any)).toBe('');
  });
});

describe('toLegacyPlace', () => {
  const place = {
    id: 'ChIJtest', displayName: { text: 'Taco Loco', languageCode: 'en' }, location: { latitude: 37.77, longitude: -122.41 },
    formattedAddress: '101 Market St, San Francisco, CA 94103, USA', types: ['mexican_restaurant', 'restaurant', 'food'], businessStatus: 'OPERATIONAL',
    rating: 4.2, currentOpeningHours: { openNow: false, weekdayDescriptions: [], periods: [] },
  };
  it('has the fields the existing code reads', () => {
    expect(toLegacyPlace(place)).toMatchObject({
      place_id: 'ChIJtest', name: 'Taco Loco', geometry: { location: { lat: 37.77, lng: -122.41 } },
      vicinity: '101 Market St, San Francisco, CA 94103, USA', city: 'San Francisco', rating: 4.2, types: ['mexican_restaurant', 'restaurant', 'food'],
      opening_hours: { open_now: false },
    });
  });
  it('leaves rating and hours out when Google has none', () => {
    const p = toLegacyPlace({ ...place, rating: undefined, currentOpeningHours: undefined })!;
    expect(p.rating).toBeUndefined();
    expect(p.opening_hours).toBeUndefined();
  });
  it('drops places that are closed for good, or have no id, name or location', () => {
    expect(toLegacyPlace({ ...place, businessStatus: 'CLOSED_PERMANENTLY' })).toBeNull();
    expect(toLegacyPlace({ ...place, businessStatus: 'CLOSED_TEMPORARILY' })).not.toBeNull();
    expect(toLegacyPlace({ ...place, id: undefined })).toBeNull();
    expect(toLegacyPlace({ ...place, displayName: undefined })).toBeNull();
    expect(toLegacyPlace({ ...place, location: {} })).toBeNull();
    expect(toLegacyPlace(null)).toBeNull();
  });
});

describe('parseNearbyResponse', () => {
  it('keeps the usable places, in order', () => {
    const a = { id: 'A', displayName: { text: 'A' }, location: { latitude: 1, longitude: 2 } };
    const b = { id: 'B', displayName: { text: 'B' }, location: { latitude: 3, longitude: 4 }, businessStatus: 'CLOSED_PERMANENTLY' };
    const c = { id: 'C', displayName: { text: 'C' }, location: { latitude: 5, longitude: 6 } };
    expect(parseNearbyResponse({ places: [a, b, c] }).map((p) => p.place_id)).toEqual(['A', 'C']);
  });
  it('is empty for no places, or an odd answer', () => {
    expect(parseNearbyResponse({})).toEqual([]);
    expect(parseNearbyResponse(null)).toEqual([]);
    expect(parseNearbyResponse({ places: 'x' })).toEqual([]);
  });
});

describe('describeGoogleError', () => {
  it('reads Google\'s error answer, or falls back to the HTTP status', () => {
    expect(describeGoogleError({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Places API (New) has not been used' } }, 403))
      .toBe('403 PERMISSION_DENIED Places API (New) has not been used');
    expect(describeGoogleError(null, 500)).toBe('HTTP 500');
  });
});

describe('the two category calls', () => {
  it('are meals and cafes / treats, with no type in both', () => {
    expect(SEARCH_GROUPS).toEqual([MEAL_TYPES, TREAT_TYPES]);
    expect(MEAL_TYPES).toEqual(expect.arrayContaining(['restaurant', 'fast_food_restaurant', 'meal_takeaway', 'sandwich_shop']));
    expect(TREAT_TYPES).toEqual(expect.arrayContaining(['cafe', 'coffee_shop', 'bakery', 'ice_cream_shop']));
    expect(MEAL_TYPES.filter((t) => TREAT_TYPES.includes(t))).toEqual([]);
    expect(new Set(FOOD_TYPES)).toEqual(new Set([...MEAL_TYPES, ...TREAT_TYPES]));
  });
  it('are at most two calls, and at most 40 places', () => {
    expect(NEW_API_MAX_CALLS).toBe(2);
    expect(NEW_API_MAX_RESULTS).toBe(40);
  });
  it('each ask for the 20 nearest of their own types', () => {
    for (const group of SEARCH_GROUPS) {
      const body = JSON.parse(buildNearbyRequest(1, 2, 5000, 'K', group).init.body);
      expect(body.includedTypes).toEqual(group);
      expect(body.maxResultCount).toBe(20);
      expect(body.rankPreference).toBe('DISTANCE');
    }
  });
  it('the single call still asks for every type', () => {
    expect(JSON.parse(buildNearbyRequest(1, 2, 5000, 'K').init.body).includedTypes).toEqual(FOOD_TYPES);
  });
});

describe('mergePlaces', () => {
  const p = (id: string) => ({ place_id: id });
  it('joins the lists in order, each place once, the first copy winning', () => {
    expect(mergePlaces([[p('a'), p('b')], [p('b'), p('c')]]).map((x) => x.place_id)).toEqual(['a', 'b', 'c']);
  });
  it('stops at the cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`m${i}`));
    const more = Array.from({ length: 30 }, (_, i) => p(`n${i}`));
    expect(mergePlaces([many, more])).toHaveLength(40);
    expect(mergePlaces([many, more], 25)).toHaveLength(25);
  });
  it('skips entries without an id, and copes with empty lists', () => {
    expect(mergePlaces([[{}, p('a')], []]).map((x) => x.place_id)).toEqual(['a']);
    expect(mergePlaces([])).toEqual([]);
  });
});

describe('leaving out chain-heavy types (franchises switched off)', () => {
  it('excludes fast food by main type and no longer asks for it', () => {
    const body = JSON.parse(buildNearbyRequest(1, 2, 5000, 'K', MEAL_TYPES, CHAIN_HEAVY_PRIMARY_TYPES).init.body);
    expect(CHAIN_HEAVY_PRIMARY_TYPES).toEqual(['fast_food_restaurant']);
    expect(body.excludedPrimaryTypes).toEqual(['fast_food_restaurant']);
    expect(body.includedTypes).not.toContain('fast_food_restaurant');
    expect(body.includedTypes).toEqual(expect.arrayContaining(['restaurant', 'meal_takeaway', 'sandwich_shop']));
  });
  it('sends nothing extra when franchises are shown', () => {
    const body = JSON.parse(buildNearbyRequest(1, 2, 5000, 'K', MEAL_TYPES).init.body);
    expect('excludedPrimaryTypes' in body).toBe(false);
    expect(body.includedTypes).toEqual(MEAL_TYPES);
  });
});
