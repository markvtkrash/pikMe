import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Geocodes a free-text location (zip code, city, address) into coordinates.
// The restaurant-owner claim flow uses the result of this + the exact same
// fetch-nearby-restaurants logic customers use, so an owner can only ever
// claim a restaurant that a customer physically searching from that same
// location would actually be able to discover — instead of the previous
// unconstrained global Text Search, which let an owner claim a location
// arbitrarily far from anywhere a real customer search could reach.
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Calls Google's billable Geocoding API — require a real logged-in
    // caller (any authenticated user: consumer, owner, or admin) so this
    // can't be hit anonymously by anyone who just has the public anon key
    // and this URL, which would otherwise let a script run up the Google
    // bill with no rate limit at all.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authedSupabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { query } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "A zip code, city, or address is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[restaurant-search] Geocoding query:", query);

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_KEY}`;
    const response = await fetch(geocodeUrl);
    console.log("[restaurant-search] Google HTTP status:", response.status);
    const data = await response.json();
    console.log("[restaurant-search] Google status field:", data.status, "- result count:", data.results?.length ?? 0);

    if (data.status !== "OK" || !data.results?.length) {
      console.warn("[restaurant-search] Geocode failed or empty:", data.status, data.error_message);
      return new Response(
        JSON.stringify({ error: "Could not find that location. Try a zip code or city name." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const top = data.results[0];
    console.log("[restaurant-search] Resolved to:", top.formatted_address, top.geometry.location);
    return new Response(
      JSON.stringify({
        latitude: top.geometry.location.lat,
        longitude: top.geometry.location.lng,
        formattedAddress: top.formatted_address,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[restaurant-search] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
