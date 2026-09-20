import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;

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
    try {
      const placeDetailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlaceId}&key=${GOOGLE_PLACES_KEY}&fields=place_id,name,formatted_address`;
      const placeRes = await fetch(placeDetailsUrl);
      const placeData = await placeRes.json();

      if (placeData.status !== "OK") {
        return new Response(
          JSON.stringify({ error: "Restaurant not found on Google Places" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
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
