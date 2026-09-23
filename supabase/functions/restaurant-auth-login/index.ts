import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { email, password } = await req.json();

    // Validate input
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!data.user || !data.session) {
      return new Response(
        JSON.stringify({ error: "Failed to sign in" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify restaurant owner record exists
    const { data: ownerData, error: ownerError } = await supabase
      .from("restaurant_owners")
      .select("id, business_name, email, must_change_password, is_active")
      .eq("id", data.user.id)
      .single();

    if (ownerError || !ownerData) {
      console.error("[restaurant-auth-login] Owner record not found:", ownerError);
      return new Response(
        JSON.stringify({ error: "Not a restaurant owner account" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Admin-deactivated accounts authenticate fine at the Supabase Auth layer
    // (we don't touch GoTrue's own ban state) but must not get a session back
    // from this app's login flow -- the owner app only ever obtains a session
    // through this endpoint, so this is sufficient to block them from here.
    if (ownerData.is_active === false) {
      return new Response(
        JSON.stringify({ error: "This account has been deactivated. Contact support for assistance." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        session: data.session,
        mustChangePassword: ownerData.must_change_password === true,
        user: {
          id: data.user.id,
          email: data.user.email,
          businessName: ownerData.business_name,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[restaurant-auth-login] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
