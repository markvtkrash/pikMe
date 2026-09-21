import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  "restaurant", "food", "point_of_interest", "establishment",
  "store", "health", "premise",
]);

function err(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Lets an owner find THEIR restaurant by name instead of only browsing
// Google's prominence-ranked Nearby Search results, which can exclude a
// real, existing restaurant that just isn't rated/reviewed enough to make
// the top ~20 for a given area (confirmed case: Costa Vida). Google's Text
// Search `query` does genuine name matching, unlike Nearby Search's category
// browse — but `location`+`radius` on Text Search is only a ranking BIAS,
// not a hard filter, so results are filtered again here to actually enforce
// the radius. This preserves the same guarantee restaurant-search.ts
// documents: an owner can only claim a restaurant that a real customer
// searching from that same location/radius could also discover — Text
// Search just changes HOW that radius-bounded set gets matched (by name)
// instead of removing the bound entirely.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err("Method not allowed", 405);

  try {
    if (!GOOGLE_PLACES_KEY) return err("GOOGLE_PLACES_KEY secret not configured", 500);

    const { businessName, latitude, longitude, radiusMeters } = await req.json();
    if (!businessName || typeof businessName !== "string" || !businessName.trim()) {
      return err("A business name is required", 400);
    }
    if (latitude == null || longitude == null) {
      return err("latitude and longitude are required", 400);
    }

    // Same cap philosophy as fetch-nearby-restaurants — bounded, not
    // unlimited, and Google's own Text Search radius param caps at 50km.
    const cappedRadius = Math.min(Number(radiusMeters) || 8000, 50000);

    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", businessName.trim());
    url.searchParams.set("location", `${latitude},${longitude}`);
    url.searchParams.set("radius", String(cappedRadius));
    url.searchParams.set("key", GOOGLE_PLACES_KEY);

    const templateUrl = url.toString().replace(GOOGLE_PLACES_KEY, "YOUR_KEY_HERE");
    console.log("[restaurant-name-search] Request (key masked):", templateUrl);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      console.error("[restaurant-name-search] Google Places HTTP", res.status, body.slice(0, 300));
      return err(`Google Places HTTP ${res.status}`, 502);
    }
    const data = await res.json();
    console.log("[restaurant-name-search] Google status:", data.status, "- raw result count:", data.results?.length ?? 0);

    if (data.status === "ZERO_RESULTS") {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (data.status !== "OK") {
      console.error("[restaurant-name-search] Google Places non-OK status:", data.status, data.error_message);
      return err(`Google Places: ${data.error_message ?? data.status}`, 502);
    }

    // Log each raw candidate BEFORE the radius filter, so a case like "found
    // it, but the radius filter excluded it" is distinguishable from
    // "Google genuinely found nothing" without needing to reproduce live.
    for (const place of data.results ?? []) {
      const d = Math.round(haversine(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng));
      console.log("[restaurant-name-search] Candidate:", place.name, "-", d, "m away (radius cap:", cappedRadius, "m)");
    }

    const results = (data.results ?? [])
      .map((place: any) => {
        const photoReference = place.photos?.[0]?.photo_reference ?? null;
        const distanceMeters = Math.round(
          haversine(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
        );
        return {
          placeId: place.place_id,
          name: place.name,
          location: {
            latitude: place.geometry.location.lat,
            longitude: place.geometry.location.lng,
            address: place.formatted_address ?? "",
            city: "",
          },
          distanceMeters,
          rating: place.rating ?? 0,
          cuisineTypes: (place.types ?? []).filter((t: string) => !GENERIC_TYPES.has(t)),
          photoUrl: photoReference
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${photoReference}&key=${GOOGLE_PLACES_KEY}`
            : undefined,
          openNow: place.opening_hours?.open_now ?? false,
          hasNutritionData: false,
        };
      })
      // Text Search's `radius` is a bias, not a hard filter — enforce it for
      // real so the "only what a real nearby customer could find" guarantee
      // still holds.
      .filter((r: any) => r.distanceMeters <= cappedRadius)
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters)
      .slice(0, 20);

    console.log("[restaurant-name-search] Query:", businessName, "- found", results.length, "within", cappedRadius, "m");

    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[restaurant-name-search] Error:", error);
    return err("Internal server error", 500);
  }
});
