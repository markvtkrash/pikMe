import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Verify the caller is an authenticated admin
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
      console.error("[admin-create-owner] SUPABASE_SERVICE_ROLE_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: missing service role key" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify admin role with the service-role client, which bypasses RLS. The
    // proxied user JWT is not reliably honored by PostgREST in self-hosted
    // setups, so we look up the verified caller id directly.
    const { data: roleRow, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) {
      console.error("[admin-create-owner] Role lookup failed:", roleError);
      return new Response(
        JSON.stringify({ error: `Role lookup failed: ${roleError.message}` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!roleRow) {
      console.error("[admin-create-owner] Caller is not an admin:", caller.user.id);
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Validate input
    const body = await req.json();
    const { password, businessName, googlePlaceId, restaurantName, address } = body;
    // Normalized once here so every lookup/insert below (the duplicate check,
    // createUser, and the restaurant_owners row) agrees on the same casing —
    // Supabase Auth itself treats email uniqueness as case-insensitive, so an
    // exact-case comparison here could miss a real duplicate.
    const email: string | undefined = body.email?.trim().toLowerCase();
    if (!email || !password || !businessName || !googlePlaceId || !restaurantName || !address) {
      return new Response(
        JSON.stringify({
          error:
            "email, password, businessName, googlePlaceId, restaurantName, and address are required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Guard against claiming a restaurant that already exists
    const { data: existingRestaurant } = await adminClient
      .from("restaurants")
      .select("id")
      .eq("google_place_id", googlePlaceId)
      .maybeSingle();

    if (existingRestaurant) {
      return new Response(
        JSON.stringify({ error: "This restaurant has already been claimed" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3b. Guard against a duplicate email — createUser's own duplicate-email
    // error isn't reliably surfaced by self-hosted GoTrue, so check explicitly
    // and give a specific, actionable message rather than a silent/generic
    // failure. Distinguish "signed up but never claimed" (safe to reuse that
    // account, or the admin picked the wrong email) from "already has a
    // claim" (this really is a duplicate).
    const { data: existingOwner } = await adminClient
      .from("restaurant_owners")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (existingOwner) {
      const { data: existingClaim } = await adminClient
        .from("restaurants")
        .select("name, status")
        .eq("owner_id", existingOwner.id)
        .maybeSingle();

      if (existingClaim) {
        return new Response(
          JSON.stringify({
            error: `An account with this email already exists and already has a claim on "${existingClaim.name}" (status: ${existingClaim.status}).`,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          error: "An account with this email already exists, but hasn't claimed a restaurant yet. Use a different email, or have that owner claim the restaurant themselves.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Create the auth user (email pre-confirmed since the admin is provisioning it)
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      console.error("[admin-create-owner] Failed to create user:", createError);
      return new Response(
        JSON.stringify({ error: createError?.message || "Failed to create user account" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const newUserId = created.user.id;

    // 5. Create the restaurant_owners record (flagged for forced password change)
    const { error: ownerError } = await adminClient.from("restaurant_owners").insert({
      id: newUserId,
      email,
      business_name: businessName,
      must_change_password: true,
    });

    if (ownerError) {
      console.error("[admin-create-owner] Failed to create owner record:", ownerError);
      // Roll back the auth user so we don't leave an orphaned account
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({ error: ownerError.message || "Failed to create owner account" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 6. Create the restaurant record, auto-approved by this admin
    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .insert({
        owner_id: newUserId,
        google_place_id: googlePlaceId,
        name: restaurantName,
        address,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: caller.user.id,
      })
      .select()
      .single();

    if (restaurantError) {
      console.error("[admin-create-owner] Failed to create restaurant:", restaurantError);
      // Roll back owner + auth user
      await adminClient.from("restaurant_owners").delete().eq("id", newUserId);
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({ error: restaurantError.message || "Failed to create restaurant" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[admin-create-owner] Provisioned owner", email, "for restaurant", restaurantName);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Restaurant owner account created and approved",
        credentials: { email, password },
        owner: { id: newUserId, email, businessName },
        restaurant,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[admin-create-owner] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
