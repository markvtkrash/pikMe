# Customer app browser tests (Playwright)

These open the real customer-app screens in Chromium at several screen widths and look for anything that runs past the edge, can only be reached by
scrolling sideways, or spills out of its box. The backend is a **mock**: no login, and nothing reaches a real server.

## Run

1. Start the customer app's web build on a spare port with the **mock address as its Supabase URL** and the `.env` files switched off:

   ```bash
   cd user
   EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://localhost:9199 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy CI=1 npx expo start --web --port 9102 --clear
   ```

   The dev server does not reload in CI mode, so restart it after changing code.

2. In another terminal:

   ```bash
   cd user
   python e2e/test_detector.py      # proves the overflow detector catches a wide element and a sideways scroller
   python e2e/test_responsive.py    # every screen at 320, 375, 414, 768, 1024 and 1440 px
   python e2e/measure_landing.py    # how much of a menu shows on the first screen: where the first dish starts, how many are fully visible
   ```

   Useful settings: `E2E_WIDTHS=320,375`, `E2E_ONLY=signed_out|signed_in|diet`, `USER_APP_URL`, `E2E_SHOTS` (where the screenshots go; the default folder `e2e/screenshots/` is git-ignored).

## What it checks

- sign-in and sign-up (signed out); explore, a restaurant's menu as a list, as a grid and with a tile open, the AI Verdict answer, saved, chat, profile and help (signed in);
- the menu again for a person with a diet and an allergen set;
- that the ingredient notice at the bottom of the menu stays on screen while the menu scrolls.

## Safety and one thing to know

Every Supabase-style request (`/rest/v1`, `/auth/v1`, `/functions/v1`) is answered by `mock_backend.py` **whatever host the app is configured with**, and is never forwarded. The
app's built-in configuration can still carry the real address (it did when these tests were written), so the mock catches it by path. Any other outside request is refused and
recorded. The app is given a fake signed-in session; nothing checks its signature.

## Files

| File | What it is |
|---|---|
| `mock_backend.py` | answers the app's Supabase calls with made-up data and gives the page a fake session |
| `test_responsive.py` | the screens at each width, with the overflow, sideways-scroll, spill-over and pinned-notice checks |
| `measure_landing.py` | measures the first screen of a restaurant's menu on five phone sizes, as a list and as a grid |
| `test_detector.py` | a control test: the detector must flag planted problems and stay quiet on a page that fits |
