import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Edits an existing owner's business name and/or email. Email lives in both
// auth.users (login identity) and restaurant_owners (denormalized for easy
// reads elsewhere), so changing it needs the service-role Admin API -- a
// plain RPC can't touch auth.users.
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
      console.error("[admin-update-owner] SUPABASE_SERVICE_ROLE_KEY is not set");
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
      console.error("[admin-update-owner] Role lookup failed:", roleError);
      return new Response(
        JSON.stringify({ error: `Role lookup failed: ${roleError.message}` }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!roleRow) {
      console.error("[admin-update-owner] Caller is not an admin:", caller.user.id);
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { ownerId, businessName, email } = await req.json();

    if (!ownerId || !businessName || !email) {
      return new Response(
        JSON.stringify({ error: "ownerId, businessName, and email are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: existingOwner, error: existingOwnerError } = await adminClient
      .from("restaurant_owners")
      .select("id, email")
      .eq("id", ownerId)
      .single();

    if (existingOwnerError || !existingOwner) {
      return new Response(JSON.stringify({ error: "Owner not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only touch auth.users if the email is actually changing.
    if (email !== existingOwner.email) {
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(ownerId, {
        email,
        email_confirm: true,
      });
      if (authUpdateError) {
        console.error("[admin-update-owner] Failed to update auth email:", authUpdateError);
        return new Response(
          JSON.stringify({ error: authUpdateError.message || "Failed to update login email" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const { error: updateError } = await adminClient
      .from("restaurant_owners")
      .update({ business_name: businessName, email, updated_at: new Date().toISOString() })
      .eq("id", ownerId);

    if (updateError) {
      console.error("[admin-update-owner] Failed to update owner record:", updateError);
      return new Response(
        JSON.stringify({ error: updateError.message || "Failed to update owner" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[admin-update-owner] Updated owner", ownerId);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[admin-update-owner] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
