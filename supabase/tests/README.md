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
| `072_franchise_menu_sources.test.sql` | `menu_source_is_stale` (boundary, bad settings, 365 cap), `franchise_menu_sources` constraints/defaults/cascade/trigger, the `serpapiMenuRefreshDays` config row |
| `107_place_menu_issues.test.sql` | the independent-restaurant menu issues report (admin-only, independents only, every failure state, most-opened first), the admin menu-link and retry functions (admin-only, link checked, back in the queue) and the owner message (own restaurant only, gone once real items exist) (catalog check) |
| `108_admin_menu_by_place.test.sql` | admin Menu Management by location: independents listed one row per place, franchises one per name; view/edit/save scoped to one place, no sharing for a place, franchises cannot get place items, old one-argument functions gone, admin-only access (catalog check) |
| `109_text_extract_max_tokens.test.sql` | the textExtractMaxTokens setting exists, holds a whole number from 1024 to 32000, and is described |
| `110_photo_extract_max_tokens.test.sql` | the photoExtractMaxTokens setting (menu photo upload) exists, holds a whole number from 1024 to 32000, is described, and is separate from the pasted-text setting |
| `111_menu_guess_max_tokens.test.sql` | the menuGuessMaxTokens setting (the AI menu guess for a restaurant with no stored menu) exists, holds a whole number from 1024 to 32000, and is described |
| `112_menu_guess_model.test.sql` | the menuGuessModel setting (the model used only for the AI menu guess) exists, is blank or a plain model name, is described, and is separate from the reply-cap setting |
| `117_owner_menu_import_alert.test.sql` | the owner's "menu import was not successful" bell alert: shown after an empty or unreadable read of the owner's own link; hidden while a read is pending, for another user, for an admin's link, after the link changes, after a dismissal (until a newer empty read), and once real items are added after the failed read (wiring checks plus the behaviour on a real restaurant in a rolled-back transaction) |
| `116_menu_ai_call_settings.test.sql` | the menuNutritionBatchSize (1-50) and menuAiTimeoutSeconds (5-120) settings for menu-build AI calls exist, hold whole numbers in range, and are described |
| `115_menu_from_text_model.test.sql` | the menuFromTextModel setting (the model used only for pasted menu text) exists, is blank or a plain model name, is described, and the shared quicksilverModel setting is untouched |
| `113_rebuild_emptied_menus.test.sql` | a restaurant with no real items is put back in line for a real build: a franchise (marked due once its last build is old enough to retry: right away after an ok, 6 hours after an error, 72 hours after no link, never while running or flagged for an admin; the runner only handles the ok case), an independent (a "built" job set back to due), wired into the customer click and the franchise runner, server-only access (wiring checks plus the franchise behaviour in a rolled-back transaction) |
| `114_place_menu_crawl.test.sql` | the browser crawl queue: owner and admin links are recorded (admin wins, franchises skipped, bad links refused), the worker is handed each restaurant once, results are recorded (ok / no items / error retried after 6 hours then flagged), a stale result is ignored, the worker secret check, server-only access (run inside a rolled-back transaction) |
| `106_place_queue_run_now.test.sql` | `_start_place_builds_capped` with and without the daily cap (a scheduled run obeys it, a manual run does not, both obey the per-run limit), the restaurant run starts independents only, `admin_run_place_queue_now` is admin-only (rolled-back run) |
| `105_scheduled_menu_builds.test.sql` | the scheduled job for both kinds: nothing starts without the key, the per-run limit and the daily cap on independent restaurants hold, the combined entry point reports chains and places, the admin status, setters and combined recent-builds list, and the 30-minute schedule where pg_cron is installed (rolled-back run) |
| `104_merge_place_built_items.test.sql` | `merge_place_built_items`: a successful build only adds: a dish matching an AI guess confirms it (no duplicate), one already on the menu is left alone, new dishes are added verified once, nothing is deleted or overwritten, a repeat adds nothing, other places untouched, bad input refused (rolled-back run) |
| `103_independent_menus_by_place.test.sql` | an independent restaurant shows only items tied to its own place (never by name alone), a franchise keeps the shared chain menu, the queue ignores AI guesses, `delete_place_pulled_items` removes pulled items and guesses but keeps hand-entered ones, `replace_place_pulled_items` replaces the pulled menu and adds only dishes not already there (rolled-back run) |
| `102_place_menu_builds.test.sql` | `replace_place_pulled_items` (swaps pulled items, keeps verified, a failed swap changes nothing), `_start_menu_queue_builds` (nothing without the key, starts jobs once, 0 pauses it), the admin Run queue now button is admin-only, service-role-only runner (rolled-back run with a made-up server address) |
| `101_menu_build_queue.test.sql` | the menu build queue: `enqueue_menu_build` (bad input, unknown places ignored, repeats counted, already-built skipped, a chain is one job, bounded queue), `claim_menu_builds` (busiest first, separate chain and place limits, never taken twice, cut-off builds retried), `finish_menu_build` (6h / 72h delays, needs attention after repeated failures, success refresh period), resolve and retry, service-role-only (rolled-back run) |
| `100_place_menu_items.test.sql` | `upsert_place_menu_items` / `delete_place_menu_items`: ids unique per place, same-name places keep separate rows, repeat saves do not duplicate, the customer lookup prefers a place's own rows, deleting one place touches only it, bad input and franchises refused, service-role-only; the four owner actions check ownership by place (rolled-back run plus catalog check) |
| `099_tie_menu_items_to_places.test.sql` | the rules of `tie_menu_items_to_places` (claimed, approved, non-franchise, name claimed once; only verified items when other locations share the name; never an item that already has a place), logging and undo, not reachable from the apps; the dry run runs for real and changes nothing (catalog check) |
| `098_chain_menu_skip_verified_names.test.sql` | `replace_chain_menu_items` skips a dish whose name already exists as a verified item (ignoring case and spaces), counts only what it wrote, ignores a single store's own menu, still replaces old pulled rows, and stays service-role-only (runs the function for real, rolled back) |
| `097_chain_build_log.test.sql` | the runner logs every chain it starts (once, by name, with its source), removes log rows older than 30 days and does nothing without the key; the admin list is admin-only and bounded; the log table and runner are not reachable from the app (rolled-back run with a fake server address) |
| `096_chain_store_place_id.test.sql` | the Franchise Menu list returns the stored place ID and whether any store is known (last two columns); `admin_set_chain_place_id` is admin-only, checks the place ID format, marks the chain due and warns on a name mismatch; the build queue also takes chains with only a built-in page (catalog check plus a rolled-back queue test) |
| `095_chain_link_suggestion_marks_due.test.sql` | approving or replacing a suggested link marks the chain due for a fresh lookup; replace clears a stored link that is only the old built-in page (never a hand-set one); earlier guarantees unchanged (catalog check) |
| `094_replace_chain_link_suggestion.test.sql` | the review list also shows differing suggestions for chains that already have a page (current page as last column); `admin_replace_chain_link_suggestion` is admin-only, needs the page the admin saw, refuses a changed page and an unsuggested link; approve still fills only an empty page (catalog check) |
| `093_chain_link_suggestions.test.sql` | the link helpers (`normalize_menu_link`, `menu_link_host`, `menu_hosts_match`) for real; the review list / approve / dismiss functions are admin-only, signed-in-only, fill only an empty built-in page and only a link owners saved (catalog check) |
| `092_admin_add_franchise_chain.test.sql` | `admin_add_franchise_chain` is admin-only, refuses a name or alias already on the list, checks the menu page and alias limits, signed-in-only; look-alike names collide on the unique normalized name (catalog check plus a rolled-back insert) |
| `091_admin_delete_restaurant.test.sql` | `admin_delete_restaurant` is admin-only, closed-only, has a dry run, keeps the owner and a chain's/shared menu, covers every cascading table, signed-in-only (catalog check; try it on the admin page) |
| `090_admin_list_owners_address.test.sql` | `admin_list_owners` keeps its admin-only check and earlier columns and now returns `restaurant_address` as the last column, not callable by anon (catalog check) |
| `089_admin_chain_build_controls.test.sql` | the three admin build-control functions are admin-only, SECURITY DEFINER, signed-in-only, never return the key, cap builds per run at 20, and Run now uses the scheduled runner (catalog check) |
| `087_chain_menu_build_queue.test.sql` | `chains_needing_menu_build` (never built, stale, manual link queued; recent, no store, backoff, running, inactive not; order, limit, refresh period), service-role-only access, the key table hidden from the API, the runner doing nothing without a key |
| `086_menu_lookup_chain_fallback.test.sql` | `get_menu_items_for_restaurant` falls back to the chain's menu (name variation, alias) while exact-name rows, a location's own menu, out-of-stock and inactive chains behave as before |
| `085_admin_edit_chain_menu_url.test.sql` | the Chain Menus list returns the built-in page (last column), and the admin-only setter exists and does not mark a chain due (catalog check; see the page for the behaviour) |
| `084_chain_menu_urls.test.sql` | `franchise_chains.menu_url`: seeded addresses are clean https pages, the seed fills only empty ones and never overwrites a hand-set one |
| `083_admin_list_owners_place_id.test.sql` | `admin_list_owners` keeps its admin-only check and now returns `google_place_id` as the last column (catalog check; see the page for the display) |
| `082_find_chain_place_id_claimed.test.sql` | `find_chain_place_id` also finds a claimed restaurant's place ID (Create Owner), newest across both sources, no lookalikes |
| `081_find_chain_place_id.test.sql` | `find_chain_place_id`: newest matching cached store, alias match, no lookalikes, NULL when none, service-role-only |
| `080_block_owner_edits_on_chain_menus.test.sql` | the four owner menu functions still check ownership and now refuse chain restaurants (source-level check; try the behaviour in the owner app) |
| `073_chain_menu_helpers.test.sql` | `find_franchise_chain` (name/alias/inactive), `replace_chain_menu_items` (what it deletes and what it must keep: verified, per-location, saved items), refresh, bad input |
| `067_menu_items_place_id.test.sql` | `get_menu_items_for_restaurant`: template fallback, per-location precedence, out-of-stock handling, exact name match, no cross-leaks |

## Not covered here

Functions that call `_require_admin()` (the admin reports, `admin_delete_cached_restaurants`,
the Menu Management list) depend on a logged-in admin (`auth.uid()` plus a
`user_roles` row tied to `auth.users`), which these scripts don't fabricate.
Check those through the admin app.

## JavaScript tests

Each app has its own Jest suite: `cd user && npx jest` (same for `owner/` and `admin/`
where they have tests).
| `118_click_to_crawl.test.sql` | a customer opening an independent restaurant: queued for a menu link lookup (not the old build), found link goes to the crawler as a google link, owner/admin links never replaced, tried-recently and daily-cap limits, retries and give-up, real items skip the request, the scheduled job builds no independents (rolled-back transaction) |
| `119_unconfirmed_clicked_restaurants.test.sql` | the admin list of restaurants opened with no confirmed menu item: clicks recorded and counted, AI guesses do not count as confirmed, one confirmed item removes a restaurant (un-confirming brings it back), clicks on confirmed restaurants are not recorded, admin-only access (rolled-back transaction) |
| `120_recent_builds_crawler.test.sql` | admin "Recent builds" for independent restaurants now reads the crawler: ok / no_items / waiting / running / no_result outcomes, the link source and place returned, and the time window (rolled-back transaction) |
| `121_admin_place_menu_link.test.sql` | an admin's menu link for one restaurant (by place ID): bad links and places refused, saving queues the crawler as the admin link and re-queues on a second save, it wins over a link found online, a blank link removes it (rolled-back transaction) |
| `122_latest_link_wins.test.sql` | the latest menu link save wins (an owner save is queued even with an admin link set; the admin link is kept), whether the admin link worked is recorded and reset on save, the owner's note after a failed read suggests the admin link only if it worked, other users see nothing, and a link found online never replaces an owner or admin link (rolled-back transaction) |
| `123_bulk_verify_menu_items.test.sql` | confirming many menu items at once: an owner confirms only their own unconfirmed items (already-confirmed ones are not counted), an item that is not theirs rejects the whole call, another user and non-admins are refused, an admin can confirm any restaurant's items (rolled-back transaction) |
| `124_owner_link_suggestion.test.sql` | the owner's note under the link box: after a failed read of their own link, and after an admin corrects the link (their failed record is replaced) they are pointed to the working link; no note once they use it, when they have no saved link, when the admin link did not work, or for another user (rolled-back transaction) |
| `125_remove_link_lookup.test.sql` | the Google link lookup for independents is gone (table, functions and settings dropped): a click with no link gives no_link and queues nothing but is still recorded for the admin; an owner link and an admin link are still queued; a real menu is already built (rolled-back transaction) |
| `126_restaurant_kind_flags.test.sql` | the two display flags exist (true or false) and franchise_names_among returns franchise names only, ignoring repeats, blanks, empty and missing lists (wiring and lookup); the server (fetch-nearby-restaurants) applies the flags for customers |
| `127_customer_config.test.sql` | the customer app single config call: readable before sign-in, includes the minimum app version, exposes only the three whitelisted settings and no secrets |
| `128_announcements.test.sql` | in-app announcements: version compare, access (table closed, functions open to the apps), customer/owner/both audiences, scheduled and ended, version range, at most three, the customer config call carries them, edit/end/delete, validation and admin-only (rolled-back transaction) |
| `129_restaurant_categories.test.sql` | restaurant categories in three groups: seeded and closed to direct reads, Google guess sorts each type into its own group (a cafe with takeaway, delivery and a cuisine keeps all four, unknown types ignored, no place type means Restaurant), the customer config carries the categories, an admin sets and resets a restaurant (null = Google, empty = none), the trigger refuses an empty, unknown, wrong-group or repeated key, the category page functions work and are admin only (rolled-back transaction) |
| `130_category_trigger_definer.test.sql` | the category check on restaurants runs as SECURITY DEFINER (so owners can save categories) while the table stays closed to direct reads |
