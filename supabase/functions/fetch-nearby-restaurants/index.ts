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

    // Cap radius at 3km max
    const MAX_RADIUS_METERS = 3000;
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

    // Geo filtering + 7-day TTL happen in SQL against the WHOLE table (see
    // migration 021). This returns only rows truly within radiusMeters, ordered
    // nearest-first — no arbitrary 50-row slice that could miss nearby data.
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
      // Treat a cache-read failure as a miss and fall through to Google.
      console.warn('[fetch-nearby-restaurants] Cache read failed (treating as miss):', cacheReadErr);
    }
    const nearby = cachedNearby ?? [];

    console.log('[fetch-nearby-restaurants] Cache check: user at (', latitude, ',', longitude, ') found', nearby.length, 'nearby restaurants within', radiusMeters, 'meters');

    // If cache hit, return immediately (no Google API call)
    if (nearby.length > 0) {
      console.log('[fetch-nearby-restaurants] Cache hit! Returning', nearby.length, 'cached restaurants');
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

    // ── Cache miss: call Google Places API ──────────────────────────────────────────────
    console.log('[fetch-nearby-restaurants] Cache miss. Calling Google Places API...');
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('location', `${latitude},${longitude}`);
    url.searchParams.set('radius', String(Math.min(radiusMeters, 5000)));
    url.searchParams.set('type', 'restaurant');
    url.searchParams.set('key', GOOGLE_KEY);

    const placesRes = await fetch(url.toString());
    if (!placesRes.ok) {
      throw new Error(`Google Places HTTP ${placesRes.status}`);
    }

    const placesData = await placesRes.json();

    if (placesData.status === 'REQUEST_DENIED' || placesData.status === 'INVALID_REQUEST') {
      throw new Error(`Google Places: ${placesData.error_message ?? placesData.status}`);
    }

    const places: any[] = placesData.results ?? [];

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
    } catch (cacheErr) {
      console.warn('[fetch-nearby-restaurants] Cache upsert failed (non-fatal):', cacheErr);
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
