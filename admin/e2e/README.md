# Admin browser tests (Playwright)

These run the real admin pages in Chromium against a **mock backend**, so they need no login and never touch a real database. They check what a
person sees and does (filters, paging, links, console errors). They do not test SQL; that is in `supabase/tests`.

## Run

1. Start the admin web app on a spare port with the **mock address as its Supabase URL** and the `.env` files switched off
   (otherwise the app picks up the real address from `admin/.env.local`):

   ```bash
   cd admin
   EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://localhost:9199 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy EXPO_PUBLIC_CONFIG_SOURCE=db CI=1 \
     npx expo start --web --port 9101 --clear
   ```

2. In another terminal:

   ```bash
   cd admin
   python e2e/test_menu_health.py        # needs: pip install playwright, and `playwright install chromium`
   ```

   Screenshots are written to `e2e/screenshots/` (git-ignored). Set `ADMIN_URL` if the app is on another port and `E2E_SHOTS` to put the
   screenshots elsewhere.

## Safety

`mock_backend.py` refuses every request that is not to the app itself (`localhost`) or the mock (`http://localhost:9199`), and the tests fail
if a page tries to reach a real Supabase. Do not point the app at a real backend for these tests.

## Files

| File | What it is |
|---|---|
| `mock_backend.py` | answers the app's Supabase calls with made-up data (it copies the filters, source and paging of the report functions) |
| `test_menu_health.py` | the Menu Data Health report: region / city / source filters, paging, "no region on record", restaurant links, no console errors |
