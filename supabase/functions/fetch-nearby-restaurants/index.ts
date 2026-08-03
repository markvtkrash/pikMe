import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    // TEMP DEBUG — remove once MAX_RESULT_PAGES is confirmed reaching the
    // container. Shows the raw env values Deno actually sees vs. Deno.env.get()
    // silently returning undefined and falling back to defaults.
    console.log('[debug] raw env — MAX_RADIUS_METERS:', JSON.stringify(Deno.env.get('MAX_RADIUS_METERS')), 'MAX_RESULT_PAGES:', JSON.stringify(Deno.env.get('MAX_RESULT_PAGES')));

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

    // Cap radius (configurable via MAX_RADIUS_METERS secret/env var; defaults to 3km)
    const MAX_RADIUS_METERS = Number(Deno.env.get('MAX_RADIUS_METERS')) || 3000;
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

    // ── Check location-aware cache (5km radius, 7-day TTL) ──────────────────────────────
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
        const transformed = nearby.map((r) => ({
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
          photoUrl: r.photo_reference
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${r.photo_reference}&key=${GOOGLE_KEY}`
            : undefined,
          photoReference: r.photo_reference,
          openNow: r.open_now,
          openingHours: r.opening_hours ?? undefined,
          hasNutritionData: false,
        }));
        return new Response(JSON.stringify(transformed), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Area not covered yet: call Google Places API (with pagination) ─────────────────
    console.log('[fetch-nearby-restaurants] Area not covered. Calling Google Places API...');

    // Google returns max 20 results per page, 60 total across 3 pages (its own
    // hard ceiling — we can't get more no matter what). Each extra page is a
    // separate billable call plus a mandatory ~2s wait before its
    // next_page_token becomes valid, so this is configurable rather than
    // hardcoded — trade coverage for cost/latency via MAX_RESULT_PAGES.
    const MAX_RESULT_PAGES = Math.min(Math.max(Number(Deno.env.get('MAX_RESULT_PAGES')) || 1, 1), 3);

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
        // past 5000 would silently do nothing (Google's cap is 50,000m).
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

    const restaurants = places.map((place) => {
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
        photoUrl: photoReference
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${photoReference}&key=${GOOGLE_KEY}`
          : undefined,
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

    console.log('[fetch-nearby-restaurants] Returning', restaurants.length, 'restaurants from Google API');
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
