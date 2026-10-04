import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// Strong temporary password, generated here on the server with a CSPRNG
// (never in the browser). At least one of each character class, no
// look-alike characters (0/O, 1/l/I) so it's easy to read out to an owner.
function generateTemporaryPassword(length = 14): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const special = "!@#$%^&*";
  const all = upper + lower + nums + special;

  const randomInt = (max: number) => {
    // Rejection sampling so the result is unbiased.
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do {
      crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % max;
  };
  const pick = (set: string) => set[randomInt(set.length)];

  const chars = [pick(upper), pick(lower), pick(nums), pick(special)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Admin-only: sets a new random temporary password on an existing restaurant
// owner's login and flags the account so the owner must choose their own
// password at next login (restaurant_owners.must_change_password, migration
// 017). The temporary password is returned once, only to the calling admin —
// it is never logged or stored.
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    const token = authHeader.replace("Bearer ", "");
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: caller, error: callerError } = await callerClient.auth.getUser(token);
    if (callerError || !caller.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[admin-reset-owner-password] SUPABASE_SERVICE_ROLE_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: missing service role key" }),
        { status: 500, headers: JSON_HEADERS }
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
      console.error("[admin-reset-owner-password] Role lookup failed:", roleError);
      return new Response(
        JSON.stringify({ error: `Role lookup failed: ${roleError.message}` }),
        { status: 403, headers: JSON_HEADERS }
      );
    }
    if (!roleRow) {
      console.error("[admin-reset-owner-password] Caller is not an admin:", caller.user.id);
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: JSON_HEADERS });
    }

    const { ownerId } = await req.json();
    if (!ownerId) {
      return new Response(JSON.stringify({ error: "ownerId is required" }), { status: 400, headers: JSON_HEADERS });
    }

    // Only restaurant owners — this can't be used to reset an admin's or a
    // customer's password.
    const { data: owner, error: ownerError } = await adminClient
      .from("restaurant_owners")
      .select("id, email")
      .eq("id", ownerId)
      .maybeSingle();

    if (ownerError || !owner) {
      return new Response(JSON.stringify({ error: "Owner not found" }), { status: 404, headers: JSON_HEADERS });
    }

    const temporaryPassword = generateTemporaryPassword();

    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(ownerId, {
      password: temporaryPassword,
    });
    if (authUpdateError) {
      console.error("[admin-reset-owner-password] Failed to set password:", authUpdateError.message);
      return new Response(
        JSON.stringify({ error: authUpdateError.message || "Failed to reset password" }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const { error: flagError } = await adminClient
      .from("restaurant_owners")
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq("id", ownerId);
    if (flagError) {
      // The password HAS changed at this point; the owner just won't be
      // forced to replace it. Surface that instead of failing silently.
      console.error("[admin-reset-owner-password] Password set but could not flag must_change_password:", flagError.message);
    }

    console.log("[admin-reset-owner-password] Password reset for owner", ownerId, "by admin", caller.user.id);

    return new Response(
      JSON.stringify({
        success: true,
        email: owner.email,
        temporaryPassword,
        mustChangePasswordFlagged: !flagError,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error("[admin-reset-owner-password] Error:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: JSON_HEADERS });
  }
});
