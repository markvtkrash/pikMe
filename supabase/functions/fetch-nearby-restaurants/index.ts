import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { anyKindHidden, filterByKind, parseKindFlags, SHOW_ALL, type KindFlags } from './kindFilter.ts';
import { DEFAULT_CATALOG, resolveCategories, type Catalog, type CategoryDef, type OwnerCategories } from './categories.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GENERIC_TYPES = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment',
  'store', 'health', 'premise',
]);

// Cached per warm isolate (not per-request) so switching APP_CONFIG_SOURCE=db
// on doesn't add a DB round-trip to every single invocation — refreshed every
// few minutes (see DB_CONFIG_TTL_MS), so a changed setting applies without a redeploy.
let cachedDbConfig: Record<string, string> | null = null;
// The config is kept for a few minutes, then read again, so a changed setting applies without a redeploy. The cache is for
// one list of keys: a call with a different list reads again.
let cachedDbConfigAt = 0;
let cachedDbConfigSig = '';
const DB_CONFIG_TTL_MS = 5 * 60 * 1000;
async function loadDbConfig(keys: string[]): Promise<Record<string, string>> {
  if (Deno.env.get('APP_CONFIG_SOURCE') !== 'db') return {};
  const sig = [...keys].sort().join(',');
  if (cachedDbConfig && cachedDbConfigSig === sig && Date.now() - cachedDbConfigAt < DB_CONFIG_TTL_MS) return cachedDbConfig;
  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await client.from('app_config').select('key, value').in('key', keys);
    if (error) throw error;
    cachedDbConfig = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    cachedDbConfigAt = Date.now();
    cachedDbConfigSig = sig;
    return cachedDbConfig;
  } catch (loadErr) {
    console.error('[fetch-nearby-restaurants] Failed to load DB config, falling back to env/defaults:', loadErr);
    return {};
  }
}

// ── Restaurant categories (migration 129) ───────────────────────────────────
// Each restaurant gets what it is (venueTypes), how you get the food (services) and what it serves (cuisines), each as its own
// list of category keys. Google's place types are sorted into the three groups through the mapping table (kept for a few
// minutes; DEFAULT_CATALOG is the fallback when it cannot be read), and an owner's saved choice replaces Google's guess per
// group. The existing cuisineTypes field is left exactly as it was, so older apps keep working.
let catalogCache: { catalog: Catalog; at: number } | null = null;
const CATALOG_TTL_MS = 5 * 60 * 1000;

// deno-lint-ignore no-explicit-any
async function loadCatalog(supabase: any): Promise<Catalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.catalog;
  try {
    const { data: cats, error: catsErr } = await supabase
      .from('restaurant_categories')
      .select('key, grp, sort_order, label')
      .eq('is_active', true)
      .order('grp')
      .order('sort_order')
      .order('label');
    if (catsErr) throw catsErr;
    const { data: map, error: mapErr } = await supabase.from('restaurant_category_map').select('google_type, category_key');
    if (mapErr) throw mapErr;
    if (!cats || cats.length === 0) throw new Error('no categories');
    const catalog: Catalog = {
      categories: cats.map((c: { key: string; grp: string }) => ({ key: c.key, grp: c.grp }) as CategoryDef),
      map: map ?? [],
    };
    catalogCache = { catalog, at: Date.now() };
    return catalog;
  } catch (e) {
    console.warn('[fetch-nearby-restaurants] could not read the restaurant categories, using the built-in list:', e instanceof Error ? e.message : e);
    return DEFAULT_CATALOG;
  }
}

// deno-lint-ignore no-explicit-any
async function addCategories(supabase: any, restaurants: any[]): Promise<any[]> {
  if (restaurants.length === 0) return restaurants;
  const catalog = await loadCatalog(supabase);
  const owners = new Map<string, OwnerCategories>();
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('google_place_id, venue_types, services, cuisines')
      .in('google_place_id', restaurants.map((r) => r.placeId));
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.venue_types || row.services || row.cuisines) {
        owners.set(row.google_place_id, { venue_types: row.venue_types, services: row.services, cuisines: row.cuisines });
      }
    }
  } catch (e) {
    console.warn("[fetch-nearby-restaurants] could not read the owners' categories (using Google's guess):", e instanceof Error ? e.message : e);
  }
  return restaurants.map((r) => ({ ...r, ...resolveCategories(r.cuisineTypes, owners.get(r.placeId), catalog) }));
}

// ── Which kinds of restaurants customers see (migration 126) ───────────────
// The two admin switches are read straight from app_config (not through APP_CONFIG_SOURCE, which only covers settings that
// also have an environment variable) and kept for a minute, so a switch takes effect quickly. Any problem reading them
// means "show everything". Only CUSTOMERS are filtered: an admin or an owner (who may need to find a franchise to claim or
// move it) always gets the full list.
let kindFlagsCache: { flags: KindFlags; at: number } | null = null;
const KIND_FLAGS_TTL_MS = 60 * 1000;

// deno-lint-ignore no-explicit-any
async function loadKindFlags(supabase: any): Promise<KindFlags> {
  if (kindFlagsCache && Date.now() - kindFlagsCache.at < KIND_FLAGS_TTL_MS) return kindFlagsCache.flags;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['showFranchiseRestaurants', 'showIndependentRestaurants']);
    if (error) throw error;
    kindFlagsCache = { flags: parseKindFlags(data), at: Date.now() };
    return kindFlagsCache.flags;
  } catch (e) {
    console.warn('[fetch-nearby-restaurants] could not read the restaurant kind flags, showing everything:', e instanceof Error ? e.message : e);
    return SHOW_ALL;
  }
}

// deno-lint-ignore no-explicit-any
async function isStaffCaller(supabase: any, userId: string): Promise<boolean> {
  const { data: admin } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').limit(1);
  if (admin && admin.length > 0) return true;
  const { data: owner } = await supabase.from('restaurant_owners').select('id').eq('id', userId).limit(1);
  return !!(owner && owner.length > 0);
}

// deno-lint-ignore no-explicit-any
async function applyKindFlags(supabase: any, userId: string, restaurants: any[]): Promise<any[]> {
  try {
    const flags = await loadKindFlags(supabase);
    if (!anyKindHidden(flags) || restaurants.length === 0) return restaurants;
    if (await isStaffCaller(supabase, userId)) return restaurants;
    const names = Array.from(new Set(restaurants.map((r) => String(r.name ?? '').trim()).filter(Boolean)));
    const { data, error } = await supabase.rpc('franchise_names_among', { p_names: names });
    if (error) throw error;
    const franchiseNames = new Set<string>((data ?? []).map((row: { name: string }) => row.name));
    const kept = filterByKind(restaurants, franchiseNames, flags);
    if (kept.length !== restaurants.length) {
      console.log('[fetch-nearby-restaurants] Hid', restaurants.length - kept.length, 'restaurant(s) of a switched-off kind');
    }
    return kept;
  } catch (e) {
    console.warn('[fetch-nearby-restaurants] could not apply the restaurant kind flags, showing everything:', e instanceof Error ? e.message : e);
    return restaurants;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    // Can trigger a real, billable Google Nearby Search call on a cache miss
    // — require a real logged-in caller (any authenticated user: consumer,
    // owner, or admin) so this can't be hit anonymously by a script that
    // varies lat/lng to force cache misses on purpose and run up the bill.
    // supabase.functions.invoke() already forwards the caller's own session
    // token here, so legitimate app traffic needs no client-side change.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const authedSupabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const dbConfig = await loadDbConfig(['maxRadiusMiles', 'maxResultPages']);

    const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_KEY');
    if (!GOOGLE_KEY) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_PLACES_KEY secret not configured on this Edge Function' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    let { latitude, longitude, radiusMeters = 2000 } = body;

    if (latitude == null || longitude == null) {
      return new Response(
        JSON.stringify({ error: 'latitude and longitude are required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Cap radius — configurable via MAX_RADIUS_MILES secret/env var, or the
    // app_config DB row when APP_CONFIG_SOURCE=db. Stored/edited in miles
    // (not meters) specifically so it's legible on the admin Config
    // Management page; converted to meters here since that's what Google's
    // API and the rest of this function work in. Defaults to 6mi — must stay
    // at or above the consumer app's own max radius option
    // (user/src/constants/searchRadius.ts's RADIUS_OPTIONS_MILES), otherwise
    // picking a larger distance there silently does nothing: the server
    // never fetched data past this cap in the first place for the client to
    // filter down to.
    const METERS_PER_MILE = 1609.34;
    const MAX_RADIUS_MILES = Number(dbConfig.maxRadiusMiles ?? Deno.env.get('MAX_RADIUS_MILES')) || 6;
    const MAX_RADIUS_METERS = MAX_RADIUS_MILES * METERS_PER_MILE;
    if (radiusMeters > MAX_RADIUS_METERS) {
      console.log('[fetch-nearby-restaurants] Radius capped: requested', radiusMeters, '→ capped to', MAX_RADIUS_METERS);
      radiusMeters = MAX_RADIUS_METERS;
    }

    // ── Google Places API Caching Compliance ──────────────────────────────────────────
    // Per Google Maps Platform ToS:
    // - Place IDs can be cached indefinitely (exempt)
    // - Restaurant data cached for max 7 days (within policy)
    // - Photo URLs generated server-side to credit Google Maps
    // - Attribution displayed in explore.tsx and NearbyMap.tsx
    // Ref: https://developers.google.com/maps/documentation/places/web-service/policies#cache-policy

    // ── Check location-aware cache (radiusMeters-aware, 7-day TTL) ───────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Whether this area is safe to serve from cache is answered by
    // is_area_covered (migration 023) — "has a real Google search already
    // covered this point" — NOT by "does some cached restaurant happen to be
    // nearby." The latter could be satisfied by a single stray restaurant left
    // over from an unrelated search and silently short-circuit a fresh call.
    const { data: isCovered, error: coverageErr } = await supabase.rpc('is_area_covered', {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_meters: radiusMeters,
      p_max_age_hours: 7 * 24,
    });

    if (coverageErr) {
      console.warn('[fetch-nearby-restaurants] Coverage check failed (treating as not covered):', coverageErr);
    }

    let restaurants: any[] = [];
    let servedFromCache = false;

    if (isCovered && !coverageErr) {
      // Geo filtering + 7-day TTL happen in SQL against the WHOLE table (see
      // migration 021). This returns only rows truly within radiusMeters,
      // ordered nearest-first — no arbitrary 50-row slice that could miss data.
      const { data: cachedNearby, error: cacheReadErr } = await supabase.rpc(
        'get_cached_restaurants_nearby',
        {
          p_lat: latitude,
          p_lng: longitude,
          p_radius_meters: radiusMeters,
          p_max_age_hours: 7 * 24,
        }
      );

      if (cacheReadErr) {
        console.warn('[fetch-nearby-restaurants] Cache read failed after a covered check (treating as miss):', cacheReadErr);
      } else {
        const nearby = cachedNearby ?? [];
        console.log('[fetch-nearby-restaurants] Area already covered by a prior search. Serving', nearby.length, 'cached restaurants within', radiusMeters, 'meters');
        restaurants = nearby.map((r) => ({
          placeId: r.place_id,
          name: r.name,
          location: {
            latitude: r.latitude,
            longitude: r.longitude,
            address: r.address,
            city: r.city,
          },
          distanceMeters: Math.round(haversine(latitude, longitude, r.latitude, r.longitude)),
          rating: r.rating,
          cuisineTypes: r.cuisine_types,
          photoReference: r.photo_reference,
          openNow: r.open_now,
          openingHours: r.opening_hours ?? undefined,
          hasNutritionData: false,
        }));
        servedFromCache = true;
      }
    }

    if (!servedFromCache) {
      // ── Area not covered yet: call Google Places API (with pagination) ─────────────
      console.log('[fetch-nearby-restaurants] Area not covered. Calling Google Places API...');

      // Google returns max 20 results per page, 60 total across 3 pages (its own
      // hard ceiling — we can't get more no matter what). Each extra page is a
      // separate billable call plus a mandatory ~2s wait before its
      // next_page_token becomes valid, so this is configurable rather than
      // hardcoded — trade coverage for cost/latency via MAX_RESULT_PAGES.
      const MAX_RESULT_PAGES = Math.min(Math.max(Number(dbConfig.maxResultPages ?? Deno.env.get('MAX_RESULT_PAGES')) || 1, 1), 3);

      function buildPlacesUrl(pageToken?: string): URL {
        const u = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
        if (pageToken) {
          // Per Google's docs, a pagetoken request only needs pagetoken + key —
          // other params are ignored (and re-sending them can trigger errors).
          u.searchParams.set('pagetoken', pageToken);
        } else {
          u.searchParams.set('location', `${latitude},${longitude}`);
          // radiusMeters is already bounded by MAX_RADIUS_METERS above — no
          // separate hardcoded clamp here, otherwise raising MAX_RADIUS_METERS
          // further would silently do nothing (Google's own cap is 50,000m).
          u.searchParams.set('radius', String(radiusMeters));
          // `type` is a hard category filter in Nearby Search (unlike Text
          // Search, where it's just a ranking hint) — `type=restaurant` was
          // silently excluding places Google categorizes as cafe/bakery/etc
          // (e.g. Dunkin' Donuts), which never have "restaurant" in their type
          // list. `keyword` is a soft text match instead, and 'food' is present
          // on virtually every eatery Google indexes (see GENERIC_TYPES above).
          u.searchParams.set('keyword', 'food');
        }
        u.searchParams.set('key', GOOGLE_KEY);
        return u;
      }

      let places: any[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_RESULT_PAGES; page++) {
        if (page > 0) {
          if (!pageToken) break;
          // next_page_token isn't valid immediately after it's issued.
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const placesRes = await fetch(buildPlacesUrl(pageToken).toString());
        if (!placesRes.ok) {
          if (page === 0) throw new Error(`Google Places HTTP ${placesRes.status}`);
          console.warn('[fetch-nearby-restaurants] Pagination request failed, stopping at page', page + 1, '- HTTP', placesRes.status);
          break;
        }

        const placesData = await placesRes.json();

        if (placesData.status === 'REQUEST_DENIED' || placesData.status === 'INVALID_REQUEST') {
          if (page === 0) throw new Error(`Google Places: ${placesData.error_message ?? placesData.status}`);
          console.warn('[fetch-nearby-restaurants] Pagination stopped at page', page + 1, '-', placesData.status);
          break;
        }

        const pageResults = placesData.results ?? [];
        places = places.concat(pageResults);
        pageToken = placesData.next_page_token;

        console.log('[fetch-nearby-restaurants] Page', page + 1, 'of', MAX_RESULT_PAGES, '- got', pageResults.length, 'results, more pages available:', !!pageToken);

        if (!pageToken) break;
      }

      restaurants = places.map((place) => {
        const photoReference = place.photos?.[0]?.photo_reference ?? null;
        return {
          placeId: place.place_id,
          name: place.name,
          location: {
            latitude: place.geometry.location.lat,
            longitude: place.geometry.location.lng,
            address: place.vicinity ?? '',
            city: '',
          },
          distanceMeters: Math.round(
            haversine(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
          ),
          rating: place.rating ?? 0,
          cuisineTypes: (place.types ?? []).filter((t: string) => !GENERIC_TYPES.has(t)),
          photoReference, // Keep for caching
          openNow: place.opening_hours?.open_now ?? false,
          openingHours: place.opening_hours ? {
            open_now: place.opening_hours.open_now,
            weekday_text: place.opening_hours.weekday_text ?? [],
            periods: place.opening_hours.periods ?? [],
          } : undefined,
          hasNutritionData: false,
        };
      });

      // Cache restaurants in Supabase (best-effort — don't fail the request if this errors)
      try {
        if (restaurants.length > 0) {
          // SQL reads flat fields (placeId, latitude, longitude, address, city) — not nested location
          const toCache = restaurants.map((r) => ({
            placeId:        r.placeId,
            name:           r.name,
            latitude:       r.location.latitude,
            longitude:      r.location.longitude,
            address:        r.location.address,
            city:           r.location.city,
            rating:         r.rating,
            priceLevel:     null,
            cuisineTypes:   r.cuisineTypes,
            photoReference: r.photoReference ?? null,
            openingHours:   r.openingHours ?? null,
            openNow:        r.openNow,
          }));
          await supabase.rpc('upsert_restaurants', { p_restaurants: toCache });
        }

        // Record the search regardless of result count — a genuinely sparse
        // area (0 or few restaurants) should still count as "covered" so it
        // isn't re-searched via Google on every single request.
        await supabase.rpc('record_search_area', {
          p_lat: latitude,
          p_lng: longitude,
          p_radius_meters: radiusMeters,
        });
      } catch (cacheErr) {
        console.warn('[fetch-nearby-restaurants] Cache upsert / search recording failed (non-fatal):', cacheErr);
      }

      console.log('[fetch-nearby-restaurants] Got', restaurants.length, 'restaurants from Google API');
    }

    // ── Guarantee claimed restaurants never go missing from their own area ─────────
    // Google's Nearby Search ranks by "prominence" (rating + reviews + distance),
    // not strictly nearest-first, and this function only fetches the first page
    // by default — a genuinely close, real restaurant can simply not make that
    // top-20 cut. Once that happens, is_area_covered locks this area into
    // re-serving the same incomplete cache for up to 7 days. A claimed
    // restaurant is a small, known set (owners who've actually signed up) — for
    // any of those missing from this result, fetch it directly via Place
    // Details (once) and cache it by place_id, which Google's ToS exempts from
    // the cache-duration limit. After that one lookup it shows up in every
    // future nearby search's normal geo-scan, cache-hit or not, at no further
    // API cost for this restaurant.
    try {
      const { data: claimedRestaurants, error: claimedErr } = await supabase
        .from('restaurants')
        .select('google_place_id, name, status, is_paused, restaurant_owners:owner_id(is_active)');

      if (claimedErr) {
        console.warn('[fetch-nearby-restaurants] Failed to load claimed restaurants (skipping backfill):', claimedErr);
      } else {
        // A restaurant marked "closed" by an admin (out of business, permanent),
        // "paused" by its owner (temporary, self-service), or whose owner has
        // been deactivated/blocked by an admin should never reach a customer,
        // even if Google's own listing is still live -- filter it out of
        // whatever this search already turned up, on top of never backfilling
        // it below.
        const isHiddenClaim = (c: any) => {
          const owner = Array.isArray(c.restaurant_owners) ? c.restaurant_owners[0] : c.restaurant_owners;
          return c.status === 'closed' || c.is_paused || owner?.is_active === false;
        };
        const hiddenPlaceIds = new Set(
          (claimedRestaurants ?? [])
            .filter(isHiddenClaim)
            .map((c) => c.google_place_id)
        );
        if (hiddenPlaceIds.size > 0) {
          const beforeCount = restaurants.length;
          restaurants = restaurants.filter((r) => !hiddenPlaceIds.has(r.placeId));
          if (restaurants.length !== beforeCount) {
            console.log('[fetch-nearby-restaurants] Filtered out', beforeCount - restaurants.length, 'closed/paused/deactivated restaurant(s)');
          }
        }

        const presentPlaceIds = new Set(restaurants.map((r) => r.placeId));
        const missingClaimed = (claimedRestaurants ?? []).filter(
          (c) => c.google_place_id && !isHiddenClaim(c) && !presentPlaceIds.has(c.google_place_id)
        );

        // Most claimed restaurants are already cached (either from claim time,
        // or from a previous backfill) and exempt from the TTL (migration
        // 050) -- check the cache first so re-adding one to `restaurants`
        // costs a DB read, not a Google Place Details call. Only a claim
        // that's genuinely never been cached falls through to a live fetch.
        let alreadyCachedIds = new Set<string>();
        if (missingClaimed.length > 0) {
          const { data: alreadyCached, error: alreadyCachedErr } = await supabase
            .from('cached_restaurants')
            .select('*')
            .in('place_id', missingClaimed.map((c) => c.google_place_id));

          if (alreadyCachedErr) {
            console.warn('[fetch-nearby-restaurants] Failed to check cache for claimed restaurants (falling back to live fetch):', alreadyCachedErr);
          } else {
            for (const row of alreadyCached ?? []) {
              const distance = Math.round(haversine(latitude, longitude, row.latitude, row.longitude));
              if (distance > radiusMeters) continue; // genuinely outside this search's radius

              restaurants.push({
                placeId: row.place_id,
                name: row.name,
                location: { latitude: row.latitude, longitude: row.longitude, address: row.address, city: row.city },
                distanceMeters: distance,
                rating: row.rating,
                cuisineTypes: row.cuisine_types,
                photoReference: row.photo_reference,
                openNow: row.open_now,
                openingHours: row.opening_hours ?? undefined,
                hasNutritionData: false,
              });
              alreadyCachedIds.add(row.place_id);
            }
            if (alreadyCachedIds.size > 0) {
              console.log('[fetch-nearby-restaurants] Restored', alreadyCachedIds.size, 'claimed restaurant(s) from cache -- no Google call needed');
            }
          }
        }

        for (const claimed of missingClaimed) {
          if (alreadyCachedIds.has(claimed.google_place_id)) continue;
          try {
            const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
            detailsUrl.searchParams.set('place_id', claimed.google_place_id);
            detailsUrl.searchParams.set(
              'fields',
              'place_id,name,geometry,rating,types,vicinity,photos,opening_hours'
            );
            detailsUrl.searchParams.set('key', GOOGLE_KEY);

            const detailsRes = await fetch(detailsUrl.toString());
            if (!detailsRes.ok) {
              console.warn('[fetch-nearby-restaurants] Place Details HTTP', detailsRes.status, 'for claimed restaurant', claimed.name);
              continue;
            }
            const detailsData = await detailsRes.json();
            if (detailsData.status !== 'OK' || !detailsData.result?.geometry?.location) {
              console.warn('[fetch-nearby-restaurants] Place Details returned', detailsData.status, 'for claimed restaurant', claimed.name);
              continue;
            }

            const place = detailsData.result;
            const distance = Math.round(
              haversine(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
            );
            if (distance > radiusMeters) continue; // genuinely outside this search's radius

            const photoReference = place.photos?.[0]?.photo_reference ?? null;
            const backfilled = {
              placeId: place.place_id,
              name: place.name,
              location: {
                latitude: place.geometry.location.lat,
                longitude: place.geometry.location.lng,
                address: place.vicinity ?? '',
                city: '',
              },
              distanceMeters: distance,
              rating: place.rating ?? 0,
              cuisineTypes: (place.types ?? []).filter((t: string) => !GENERIC_TYPES.has(t)),
              photoReference,
              openNow: place.opening_hours?.open_now ?? false,
              openingHours: place.opening_hours ? {
                open_now: place.opening_hours.open_now,
                weekday_text: place.opening_hours.weekday_text ?? [],
                periods: place.opening_hours.periods ?? [],
              } : undefined,
              hasNutritionData: false,
            };

            restaurants.push(backfilled);

            // Cache it (by place_id, exempt from the TTL) so no future search
            // ever needs another Place Details call for this restaurant.
            await supabase.rpc('upsert_restaurants', {
              p_restaurants: [{
                placeId:        backfilled.placeId,
                name:           backfilled.name,
                latitude:       backfilled.location.latitude,
                longitude:      backfilled.location.longitude,
                address:        backfilled.location.address,
                city:           backfilled.location.city,
                rating:         backfilled.rating,
                priceLevel:     null,
                cuisineTypes:   backfilled.cuisineTypes,
                photoReference: backfilled.photoReference ?? null,
                openingHours:   backfilled.openingHours ?? null,
                openNow:        backfilled.openNow,
              }],
            });

            console.log('[fetch-nearby-restaurants] Backfilled claimed restaurant missing from Google\'s ranked results:', backfilled.name);
          } catch (detailsErr) {
            console.warn('[fetch-nearby-restaurants] Error backfilling claimed restaurant', claimed.name, ':', detailsErr);
          }
        }
      }
    } catch (fallbackErr) {
      console.warn('[fetch-nearby-restaurants] Claimed-restaurant backfill failed (non-fatal):', fallbackErr);
    }

    // Customers do not see a kind of restaurant an admin has switched off (franchise / independent).
    restaurants = await applyKindFlags(supabase, userData.user.id, restaurants);

    // What each restaurant is, how you get the food and what it serves (owner's choice, else Google's guess).
    restaurants = await addCategories(supabase, restaurants);

    console.log('[fetch-nearby-restaurants] Returning', restaurants.length, 'restaurants');
    return new Response(JSON.stringify(restaurants), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('fetch-nearby-restaurants error:', err);
    return new Response(
      JSON.stringify({ error: err?.message ?? 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
