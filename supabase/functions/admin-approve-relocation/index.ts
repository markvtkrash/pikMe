import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;

const GENERIC_TYPES = new Set([
  "restaurant", "food", "point_of_interest", "establishment",
  "store", "health", "premise",
]);

// Approves a pending "my restaurant moved" request: re-verifies the new
// listing on Google (one Place Details call, same fields used at claim
// time), re-points the restaurant's google_place_id/name/address at it, and
// reseeds cached_restaurants so consumer search reflects the new location
// immediately. Rejection doesn't need this -- it's a plain RPC
// (admin_reject_relocation_request) since it never touches Google.
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
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: caller, error: callerError } = await callerClient.auth.getUser(token);
    if (callerError || !caller.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Server misconfigured: missing service role key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) {
      return new Response(
        JSON.stringify({ error: `Role lookup failed: ${roleError.message}` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { requestId, adminNote } = await req.json();
    if (!requestId) {
      return new Response(JSON.stringify({ error: "requestId is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { data: request, error: requestError } = await adminClient
      .from("restaurant_relocation_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pending")
      .single();

    if (requestError || !request) {
      return new Response(JSON.stringify({ error: "Relocation request not found or already decided" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    // Re-verify the new listing on Google right now, at approval time --
    // not trusting whatever the owner's search UI returned earlier, and
    // this is also where the fields for re-seeding the cache come from.
    const placeDetailsUrl =
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${request.new_google_place_id}` +
      `&key=${GOOGLE_PLACES_KEY}&fields=place_id,name,formatted_address,geometry,rating,types,photos,opening_hours`;
    const placeRes = await fetch(placeDetailsUrl);
    const placeData = await placeRes.json();

    if (placeData.status !== "OK" || !placeData.result?.geometry?.location) {
      return new Response(
        JSON.stringify({ error: `Could not verify the new listing on Google (${placeData.status})` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const place = placeData.result;

    const { error: updateError } = await adminClient
      .from("restaurants")
      .update({
        google_place_id: request.new_google_place_id,
        name: place.name ?? request.new_name,
        address: place.formatted_address ?? request.new_address,
        last_relocation_decision_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.restaurant_id);

    if (updateError) {
      console.error("[admin-approve-relocation] Failed to update restaurant:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { error: requestUpdateError } = await adminClient
      .from("restaurant_relocation_requests")
      .update({
        status: "approved",
        admin_note: adminNote ?? null,
        decided_at: new Date().toISOString(),
        decided_by: caller.user.id,
      })
      .eq("id", requestId);

    if (requestUpdateError) {
      console.error("[admin-approve-relocation] Failed to mark request approved:", requestUpdateError);
    }

    // Reseed the consumer-facing cache (best-effort -- same pattern as
    // restaurant-claim's cache seeding).
    try {
      const photoReference = place.photos?.[0]?.photo_reference ?? null;
      await adminClient.rpc("upsert_restaurants", {
        p_restaurants: [{
          placeId:        request.new_google_place_id,
          name:           place.name ?? request.new_name,
          latitude:       place.geometry.location.lat,
          longitude:      place.geometry.location.lng,
          address:        place.formatted_address ?? request.new_address,
          city:           "",
          rating:         place.rating ?? 0,
          priceLevel:     null,
          cuisineTypes:   (place.types ?? []).filter((t: string) => !GENERIC_TYPES.has(t)),
          photoReference,
          openingHours:   place.opening_hours
            ? {
                open_now: place.opening_hours.open_now,
                weekday_text: place.opening_hours.weekday_text ?? [],
                periods: place.opening_hours.periods ?? [],
              }
            : null,
          openNow:        place.opening_hours?.open_now ?? false,
        }],
      });
    } catch (cacheErr) {
      console.warn("[admin-approve-relocation] Failed to reseed cache (non-fatal):", cacheErr);
    }

    console.log("[admin-approve-relocation] Approved relocation for restaurant", request.restaurant_id, "->", request.new_name);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[admin-approve-relocation] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
