"""Browser test of the admin Menu Data Health report (Playwright, real Chromium, mocked backend).

Run it (the admin app must be serving on the port, with the mock address as its Supabase URL):

    cd admin
    EXPO_PUBLIC_SUPABASE_URL=http://localhost:9199 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy CI=1 npx expo start --web --port 9101
    python e2e/test_menu_health.py            # from another terminal; screenshots go to e2e/screenshots (not committed)

It checks what a person sees and does: nothing loads until a region is chosen, the Region / City / Source filters, paging, the "no region
on record" choice, the restaurant links, and that the page logs no errors. The SQL is tested separately in supabase/tests.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mock_backend import MockBackend  # noqa: E402

BASE = os.environ.get("ADMIN_URL", "http://localhost:9101")
SHOTS = Path(os.environ.get("E2E_SHOTS", Path(__file__).resolve().parent / "screenshots"))
SHOTS.mkdir(parents=True, exist_ok=True)

failures = []


def check(condition, message):
    print(("PASS  " if condition else "FAIL  ") + message)
    if not condition:
        failures.append(message)


def text_of(page):
    return page.inner_text("body")


def click_text(page, text, exact=True, nth=0):
    page.get_by_text(text, exact=exact).nth(nth).click()


def pick(page, button_text, option_text):
    """Open a filter window from its button and choose an option by its label."""
    page.get_by_text(button_text, exact=False).first.click()
    page.get_by_text(option_text, exact=True).last.click()
    page.wait_for_timeout(600)


def main():
    mock = MockBackend()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1100, "height": 1500})
        mock.install(context)
        page = context.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        page.goto(f"{BASE}/admin/reports/menu-health", wait_until="domcontentloaded", timeout=180000)
        page.wait_for_selector("text=Menu Data Health", timeout=180000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOTS / "01-start.png"))

        # 1. nothing loads until a region is chosen
        body = text_of(page)
        check("Pick a region above" in body, "starts with a prompt to pick a region")
        check(not mock.rpc_calls("admin_report_menu_health_by_restaurant"), "no report is requested before a region is chosen")
        check(bool(mock.rpc_calls("admin_menu_health_locations")), "the region list was requested")

        # 2. choose TX
        pick(page, "Region:", "TX")
        page.wait_for_timeout(800)
        body = text_of(page)
        page.screenshot(path=str(SHOTS / "02-region-tx.png"))
        snapshot = mock.rpc_calls("admin_report_menu_health_snapshot")[-1]
        check(snapshot.get("p_state") == "tx" and not snapshot.get("p_city"), "the snapshot is requested for the region only")
        check("Showing 1-50 of" in body, "the table shows the first 50 restaurants")
        check("Page 1 of" in body, "the table has a pager")
        check("City import" in body and "Claimed" in body, "rows carry a source badge")

        # 3. paging
        click_text(page, "Next ›", nth=0)
        page.wait_for_timeout(800)
        body = text_of(page)
        page.screenshot(path=str(SHOTS / "03-page2.png"))
        offsets = [c.get("p_offset") for c in mock.rpc_calls("admin_report_menu_health_by_restaurant")]
        check(50 in offsets, "Next asks the server for the second page (offset 50)")
        check("Showing 51-" in body, "the second page shows rows from 51")

        # 4. choose a city
        pick(page, "City:", "Dallas")
        body = text_of(page)
        page.screenshot(path=str(SHOTS / "04-city-dallas.png"))
        check("Dallas Claimed" in body and "Dallas Imported 1" in body, "the Dallas restaurants are listed")
        check("Austin Imported" not in body, "Austin restaurants are not listed")
        check("Page 1 of" not in body, "a short list has no pager")

        # 5. the source filter
        click_text(page, "City imports", nth=0)
        page.wait_for_timeout(800)
        body = text_of(page)
        page.screenshot(path=str(SHOTS / "05-source-city.png"))
        check("Dallas Imported 1" in body and "Dallas Claimed" not in body, "City imports shows only imported restaurants")
        check(mock.rpc_calls("admin_report_menu_health_snapshot")[-1].get("p_source") == "city", "the source is sent to the server")
        click_text(page, "Claimed", exact=True, nth=0)
        page.wait_for_timeout(800)
        body = text_of(page)
        check("Dallas Claimed" in body and "Dallas Imported 1" not in body, "Claimed shows only claimed restaurants")
        click_text(page, "All", exact=True, nth=0)
        page.wait_for_timeout(600)

        # 6. a restaurant name is a link to its menu
        page.get_by_text("Dallas Imported 1", exact=True).first.click()
        page.wait_for_timeout(1500)
        url = page.url
        page.screenshot(path=str(SHOTS / "06-menu-link.png"))
        check("/admin/menu-view" in url and "placeId=ChIJmock" in url and "name=Dallas" in url, f"clicking a name opens its menu page by place ({url})")
        page.go_back()
        page.wait_for_selector("text=Menu Data Health", timeout=60000)
        page.wait_for_timeout(1000)

        # 7. clear, then the "no region on record" choice
        click_text(page, "Clear", exact=True, nth=0)
        page.wait_for_timeout(600)
        check("Pick a region above" in text_of(page), "Clear goes back to the prompt")
        pick(page, "Region:", "No region on record")
        body = text_of(page)
        page.screenshot(path=str(SHOTS / "07-no-region.png"))
        check(mock.rpc_calls("admin_report_menu_health_snapshot")[-1].get("p_state") == "__none__", "'No region on record' is sent as __none__")
        check("Nowhere Diner" in body, "the restaurant with no readable region is listed")

        # 8. the no-items list shows what the crawler did
        pick(page, "Region:", "TX")
        body = text_of(page)
        check("Waiting to be read" in body, "city restaurants not yet read say so")
        check("Read, no dishes found on the site" in body, "a read page with no dishes says so")
        page.screenshot(path=str(SHOTS / "08-no-items.png"))

        # 9. when the regions cannot be loaded, the page says so (and does not claim there are no restaurants)
        failing = MockBackend(fail=["admin_menu_health_locations"])
        broken = browser.new_context(viewport={"width": 1100, "height": 900})
        failing.install(broken)
        bad = broken.new_page()
        bad.goto(f"{BASE}/admin/reports/menu-health", wait_until="domcontentloaded", timeout=120000)
        bad.wait_for_selector("text=could not be loaded", timeout=60000)
        bad_text = text_of(bad)
        bad.screenshot(path=str(SHOTS / "09-regions-failed.png"))
        check("The regions could not be loaded" in bad_text, "a failed region load is reported as a failure")
        check("No restaurants yet" not in bad_text and "No claimed restaurants" not in bad_text, "and is not mistaken for an empty list")
        check(not failing.touched_a_backend(), "the failing run did not reach a real backend either")
        broken.close()

        # 10. the empty-state wording no longer says "claimed" (city imports are included)
        check("claimed restaurant" not in body.lower(), "the page no longer says 'claimed restaurant(s)' in its messages")

        # 11. the test never reached a real backend
        check(not mock.touched_a_backend(), "no request went to a real backend" + (f": {mock.touched_a_backend()[:2]}" if mock.touched_a_backend() else ""))

        # 12. the page logs no errors
        real_errors = [e for e in console_errors if "favicon" not in e.lower() and "net::ERR" not in e and "401" not in e and "Failed to load resource" not in e]
        check(not real_errors, "no errors in the browser console" + (f": {real_errors[:3]}" if real_errors else ""))

        browser.close()

    print()
    print(f"{len(failures)} check(s) failed" if failures else "All checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
