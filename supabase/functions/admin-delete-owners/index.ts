import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PER_CALL = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Permanently deletes owner logins that have no restaurant (admin only). Each owner is checked again here against the database
// rules (migration 132): no restaurant, deactivated long enough, no open support ticket. Owners that fail are skipped, with the reason.
// Deleting the sign-in account removes the owner record and, with it, any resolved tickets.
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
    const ids: unknown = body?.ownerIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string" && UUID_RE.test(x))) {
      return json({ error: "ownerIds must be a non-empty list of owner ids" }, 400);
    }
    const ownerIds = Array.from(new Set(ids as string[]));
    if (ownerIds.length > MAX_PER_CALL) return json({ error: `Delete at most ${MAX_PER_CALL} owners at a time` }, 400);

    const { data: checks, error: checkError } = await adminClient.rpc("owner_delete_check", { p_owner_ids: ownerIds });
    if (checkError) return json({ error: `Could not check the owners: ${checkError.message}` }, 500);

    const deleted: { id: string; email: string | null }[] = [];
    const skipped: { id: string; email: string | null; reason: string }[] = [];
    let ticketsRemoved = 0;

    for (const c of checks ?? []) {
      if (!c.can_delete) {
        skipped.push({ id: c.owner_id, email: c.email ?? null, reason: c.reason ?? "Not eligible" });
        continue;
      }
      const { error: delError } = await adminClient.auth.admin.deleteUser(c.owner_id);
      if (delError) {
        skipped.push({ id: c.owner_id, email: c.email ?? null, reason: `Could not delete: ${delError.message}` });
        continue;
      }
      // the owner record normally goes with the sign-in account; make sure
      await adminClient.from("restaurant_owners").delete().eq("id", c.owner_id);
      deleted.push({ id: c.owner_id, email: c.email ?? null });
      ticketsRemoved += c.resolved_tickets ?? 0;
    }

    console.log(`[admin-delete-owners] admin ${caller.user.id} deleted ${deleted.length}, skipped ${skipped.length}`);
    return json({ deleted, skipped, ticketsRemoved });
  } catch (e) {
    console.error("[admin-delete-owners] Error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
