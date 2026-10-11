import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// An admin permanently deletes one owner login from the Manage Users page. Only an owner login with no restaurant that has been
// deactivated long enough passes (migration 132 rules), so a login that still runs a restaurant can never be deleted from here.
// A customer, an admin, or the caller's own account is always refused.
serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: caller, error: callerError } = await callerClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (callerError || !caller.user) return json({ error: "Unauthorized" }, 401);
    if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Server misconfigured: missing service role key" }, 500);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleError } = await adminClient
      .from("user_roles").select("role").eq("user_id", caller.user.id).eq("role", "admin").maybeSingle();
    if (roleError) return json({ error: `Role lookup failed: ${roleError.message}` }, 403);
    if (!roleRow) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return json({ error: "userId is required" }, 400);
    if (userId === caller.user.id) return json({ error: "You cannot delete your own account here" }, 400);

    const { data: targetAdmin, error: adminLookupError } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (adminLookupError) return json({ error: `Role lookup failed: ${adminLookupError.message}` }, 500);
    if (targetAdmin) return json({ error: "An admin account cannot be deleted here" }, 400);

    const { data: ownerRow, error: ownerLookupError } = await adminClient
      .from("restaurant_owners").select("id").eq("id", userId).maybeSingle();
    if (ownerLookupError) return json({ error: `Owner lookup failed: ${ownerLookupError.message}` }, 500);

    if (!ownerRow) return json({ error: "Only owner logins can be deleted here" }, 400);

    const { data: checks, error: checkError } = await adminClient.rpc("owner_delete_check", { p_owner_ids: [userId] });
    if (checkError) return json({ error: `Could not check the owner: ${checkError.message}` }, 500);
    const check = (checks ?? [])[0];
    if (!check?.can_delete) return json({ error: check?.reason ?? "This owner cannot be deleted" }, 409);

    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      console.error("[admin-delete-user] Failed to delete auth user:", authDeleteError);
      return json({ error: authDeleteError.message || "Failed to delete the account" }, 500);
    }
    await adminClient.from("restaurant_owners").delete().eq("id", userId);

    console.log(`[admin-delete-user] admin ${caller.user.id} deleted owner ${userId}`);
    return json({ deleted: true });
  } catch (e) {
    console.error("[admin-delete-user] Error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
