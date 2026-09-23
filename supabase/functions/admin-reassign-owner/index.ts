import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Transfers an existing claimed restaurant to a brand-new owner account (e.g.
// the business was sold). Creates the buyer's login, repoints the
// restaurant's owner_id, and deactivates the seller's account -- the
// restaurant itself, its menu, and its coupon history are untouched. Only
// supports handing off to a NEW buyer account: the rest of the owner app
// assumes one owner = one restaurant, so this deliberately doesn't support
// reassigning to an owner who already has a restaurant.
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
      console.error("[admin-reassign-owner] SUPABASE_SERVICE_ROLE_KEY is not set");
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
      console.error("[admin-reassign-owner] Role lookup failed:", roleError);
      return new Response(
        JSON.stringify({ error: `Role lookup failed: ${roleError.message}` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!roleRow) {
      console.error("[admin-reassign-owner] Caller is not an admin:", caller.user.id);
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { restaurantId, newOwnerEmail, newOwnerPassword, newOwnerBusinessName } = await req.json();

    if (!restaurantId || !newOwnerEmail || !newOwnerPassword || !newOwnerBusinessName) {
      return new Response(
        JSON.stringify({
          error: "restaurantId, newOwnerEmail, newOwnerPassword, and newOwnerBusinessName are required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (newOwnerPassword.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("id, name, owner_id")
      .eq("id", restaurantId)
      .single();

    if (restaurantError || !restaurant) {
      return new Response(JSON.stringify({ error: "Restaurant not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const oldOwnerId = restaurant.owner_id;

    // 1. Create the buyer's auth account (email pre-confirmed, same as admin-create-owner)
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: newOwnerEmail,
      password: newOwnerPassword,
      email_confirm: true,
    });

    if (createError || !created.user) {
      console.error("[admin-reassign-owner] Failed to create new owner user:", createError);
      return new Response(
        JSON.stringify({ error: createError?.message || "Failed to create new owner account" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const newOwnerId = created.user.id;

    // 2. Create the buyer's restaurant_owners record
    const { error: ownerError } = await adminClient.from("restaurant_owners").insert({
      id: newOwnerId,
      email: newOwnerEmail,
      business_name: newOwnerBusinessName,
      must_change_password: true,
      is_active: true,
    });

    if (ownerError) {
      console.error("[admin-reassign-owner] Failed to create new owner record:", ownerError);
      await adminClient.auth.admin.deleteUser(newOwnerId);
      return new Response(
        JSON.stringify({ error: ownerError.message || "Failed to create new owner account" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Repoint the restaurant at the buyer
    const { error: reassignError } = await adminClient
      .from("restaurants")
      .update({ owner_id: newOwnerId, updated_at: new Date().toISOString() })
      .eq("id", restaurantId);

    if (reassignError) {
      console.error("[admin-reassign-owner] Failed to reassign restaurant:", reassignError);
      // Roll back the buyer account so we don't leave an orphaned owner with no restaurant
      await adminClient.from("restaurant_owners").delete().eq("id", newOwnerId);
      await adminClient.auth.admin.deleteUser(newOwnerId);
      return new Response(
        JSON.stringify({ error: reassignError.message || "Failed to reassign restaurant" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Deactivate the seller's account (data retained, just can't log in anymore)
    if (oldOwnerId) {
      const { error: deactivateError } = await adminClient
        .from("restaurant_owners")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", oldOwnerId);

      if (deactivateError) {
        // Non-fatal: the reassignment itself already succeeded. Log so an
        // admin can manually deactivate the old owner if this step failed.
        console.warn("[admin-reassign-owner] Reassigned but failed to deactivate old owner:", deactivateError);
      }
    }

    console.log("[admin-reassign-owner] Reassigned restaurant", restaurant.name, "from", oldOwnerId, "to", newOwnerId);

    return new Response(
      JSON.stringify({
        success: true,
        message: `${restaurant.name} reassigned successfully`,
        newOwner: { id: newOwnerId, email: newOwnerEmail, businessName: newOwnerBusinessName },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[admin-reassign-owner] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
