import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GOOGLE_PLACES_KEY = Deno.env.get("GOOGLE_PLACES_KEY")!;

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
    const { query } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "A zip code, city, or address is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_PLACES_KEY}`;
    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.status !== "OK" || !data.results?.length) {
      return new Response(
        JSON.stringify({ error: "Could not find that location. Try a zip code or city name." }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const top = data.results[0];
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
