# SQL tests

Plain-SQL tests for database functions. Each file is self-contained: it creates
its own fixtures inside a transaction and ends with `ROLLBACK`, so it is safe to
run against a real database and leaves nothing behind.

## How to run

- **Supabase SQL editor:** paste a file and run it. Success shows `PASS: ...`
  notices (open the Messages/Notices panel) and no error. A failed `ASSERT` stops
  the script and names the failing case.
- **psql:** `psql "$DATABASE_URL" -f supabase/tests/067_menu_items_place_id.test.sql`

They run as the database owner, so they test function logic, not row-level
security or role grants.

## Files

| File | Covers |
|------|--------|
| `062_franchise_chains.test.sql` | `normalize_restaurant_name`, `is_franchise_chain`, the `franchise_chains` trigger, uniqueness, deactivation, seed sanity |
| `067_menu_items_place_id.test.sql` | `get_menu_items_for_restaurant`: template fallback, per-location precedence, out-of-stock handling, exact name match, no cross-leaks |

## Not covered here

Functions that call `_require_admin()` (the admin reports, `admin_delete_cached_restaurants`,
the Menu Management list) depend on a logged-in admin (`auth.uid()` plus a
`user_roles` row tied to `auth.users`), which these scripts don't fabricate.
Check those through the admin app.

## JavaScript tests

Each app has its own Jest suite: `cd user && npx jest` (same for `owner/` and `admin/`
where they have tests).
