import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;

const GENERIC_TYPES = new Set([
  "restaurant", "food", "point_of_interest", "establishment",
  "store", "health", "premise",
]);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get authenticated user
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { googlePlaceId, restaurantName, address } = await req.json();

    if (!googlePlaceId || !restaurantName || !address) {
      return new Response(
        JSON.stringify({ error: "googlePlaceId, restaurantName, and address required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the place exists on Google Places API (optional, for safety).
    // website_url is intentionally NOT sourced from Google here — it's set
    // by the owner afterward on their Restaurant Profile page instead. See
    // that page for why (trust boundary: an owner-provided domain isn't
    // independently verified, unlike a Google-sourced one would have been —
    // an accepted trade-off since most small restaurants have no Google
    // website on file at all).
    //
    // This same call also pulls the fields needed to seed cached_restaurants
    // right now (step 1 of the consumer-side cost fix) -- an owner claiming
    // is a small, known, one-time event per restaurant, unlike the old
    // design where a random future customer search would have to discover
    // and cache it instead, sometimes repeatedly. Combined with 050's TTL
    // exemption for claimed restaurants, this restaurant never needs a
    // Google Place Details call from the consumer side again.
    let verifiedPlace: any = null;
    try {
      const placeDetailsUrl =
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlaceId}` +
        `&key=${GOOGLE_PLACES_KEY}&fields=place_id,name,formatted_address,geometry,rating,types,photos,opening_hours`;
      const placeRes = await fetch(placeDetailsUrl);
      const placeData = await placeRes.json();

      if (placeData.status !== "OK") {
        return new Response(
          JSON.stringify({ error: "Restaurant not found on Google Places" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      verifiedPlace = placeData.result;
    } catch (error) {
      console.warn("[restaurant-claim] Could not verify with Google Places:", error);
      // Continue anyway - allow claim even if verification fails
    }

    // Check if already claimed by someone else
    const { data: existing } = await supabase
      .from("restaurants")
      .select("id, owner_id")
      .eq("google_place_id", googlePlaceId)
      .single();

    if (existing && existing.owner_id !== userData.user.id) {
      return new Response(
        JSON.stringify({ error: "This restaurant has already been claimed" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    if (existing) {
      // Already owned by this user
      return new Response(
        JSON.stringify({
          success: true,
          message: "You already own this restaurant",
          restaurantId: existing.id,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Claim the restaurant (status: pending for admin approval)
    const { data: claimed, error: claimError } = await supabase
      .from("restaurants")
      .insert({
        owner_id: userData.user.id,
        google_place_id: googlePlaceId,
        name: restaurantName,
        address: address,
        status: 'pending',
      })
      .select()
      .single();

    if (claimError) {
      console.error("[restaurant-claim] Failed to claim restaurant:", claimError);
      return new Response(
        JSON.stringify({ error: claimError.message }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Seed the consumer-facing cache right now (best-effort -- a failure
    // here shouldn't fail the claim itself; worst case it just falls back to
    // the old discover-on-demand backfill path).
    if (verifiedPlace?.geometry?.location) {
      try {
        const photoReference = verifiedPlace.photos?.[0]?.photo_reference ?? null;
        await supabase.rpc("upsert_restaurants", {
          p_restaurants: [{
            placeId:        googlePlaceId,
            name:           verifiedPlace.name ?? restaurantName,
            latitude:       verifiedPlace.geometry.location.lat,
            longitude:      verifiedPlace.geometry.location.lng,
            address:        verifiedPlace.formatted_address ?? address,
            city:           "",
            rating:         verifiedPlace.rating ?? 0,
            priceLevel:     null,
            cuisineTypes:   (verifiedPlace.types ?? []).filter((t: string) => !GENERIC_TYPES.has(t)),
            photoReference,
            openingHours:   verifiedPlace.opening_hours
              ? {
                  open_now: verifiedPlace.opening_hours.open_now,
                  weekday_text: verifiedPlace.opening_hours.weekday_text ?? [],
                  periods: verifiedPlace.opening_hours.periods ?? [],
                }
              : null,
            openNow:        verifiedPlace.opening_hours?.open_now ?? false,
          }],
        });
        console.log("[restaurant-claim] Cached restaurant for consumer discovery:", restaurantName);
      } catch (cacheErr) {
        console.warn("[restaurant-claim] Failed to seed cache (non-fatal):", cacheErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Restaurant claimed successfully!",
        restaurant: claimed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[restaurant-claim] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
