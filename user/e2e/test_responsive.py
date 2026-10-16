"""Responsive check of the customer app (Playwright, real Chromium, mocked backend).

Run it (the customer app must be serving on the port, with the mock address as its Supabase URL and .env files off):

    cd user
    EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://localhost:9199 EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy CI=1 npx expo start --web --port 9102 --clear
    python e2e/test_responsive.py            # from another terminal; screenshots go to e2e/screenshots (not committed)

For every screen and every screen width it looks for anything that runs past the right edge or can only be reached by scrolling sideways.
"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mock_backend import MockBackend  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # the Windows console cannot print a star or an arrow

BASE = os.environ.get("USER_APP_URL", "http://localhost:9102")
SHOTS = Path(os.environ.get("E2E_SHOTS", Path(__file__).resolve().parent / "screenshots"))
SHOTS.mkdir(parents=True, exist_ok=True)
WIDTHS = [int(w) for w in os.environ.get("E2E_WIDTHS", "320,375,414,768,1024,1440").split(",")]
HEIGHT = 900

# Finds anything wider than the screen: an element that sticks out to the right (or left) and is not clipped by a parent, and a container that
# scrolls sideways.
OVERFLOW_JS = """
() => {
  const W = window.innerWidth;
  const out = [];
  const label = (el) => {
    const t = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${t ? ' "' + t + '"' : ''}`;
  };
  const clippedByParent = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible') {
        const r = p.getBoundingClientRect();
        if (r.right <= W + 1 && r.left >= -1) return true;
      }
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > W + 1 || r.left < -1) && !clippedByParent(el)) out.push({ kind: 'sticks out', what: label(el), right: Math.round(r.right) });
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      out.push({ kind: 'scrolls sideways', what: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }
  // text that is wider than the box it sits in and is not clipped or scrolled: it spills over its neighbours (a tag in a narrow tile, say)
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    // an inline link inside a sentence that wraps has a box that spans both lines: not a real overflow
    if (s.display === 'none' || s.display === 'inline' || s.visibility === 'hidden' || s.position === 'absolute' || s.position === 'fixed') continue;
    const parent = el.parentElement;
    if (!parent || parent === document.body) continue;
    const ps = getComputedStyle(parent);
    if (ps.overflowX !== 'visible' || ps.position === 'absolute') continue;
    const r = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (r.width === 0 || pr.width === 0) continue;
    if (r.right > pr.right + 2 && (el.innerText || '').trim()) {
      // a flex row's children may shrink instead; only report when the parent really is narrower than its child
      out.push({ kind: 'spills out of its box', what: label(el), over: Math.round(r.right - pr.right) });
    }
  }
  if (document.documentElement.scrollWidth > W + 1) out.push({ kind: 'page wider than screen', what: 'html', scrollWidth: document.documentElement.scrollWidth });
  return out;
}
"""

failures = []
checked = 0


def report(screen, width, issues):
    global checked
    checked += 1
    ok = not issues
    print(("PASS  " if ok else "FAIL  ") + f"{screen} @ {width}px" + ("" if ok else f": {issues[:3]}"))
    if not ok:
        failures.append((screen, width, issues))


def settle(page, ms=900):
    page.wait_for_timeout(ms)


def check(page, screen, width, shot=True):
    settle(page, 700)
    if shot:
        page.screenshot(path=str(SHOTS / f"{screen.replace(' ', '_').replace('/', '_')}-{width}.png"))
    report(screen, width, page.evaluate(OVERFLOW_JS))


def run_signed_out(browser, width):
    mock = MockBackend()
    ctx = browser.new_context(viewport={"width": width, "height": HEIGHT})
    mock.install(ctx, signed_in=False)
    page = ctx.new_page()
    page.goto(f"{BASE}/sign-in", wait_until="domcontentloaded", timeout=180000)
    page.wait_for_selector("text=Sign in to your account", timeout=120000)
    check(page, "sign-in", width)
    page.get_by_text("Register", exact=True).first.click()
    page.wait_for_selector("text=Create an account", timeout=30000)
    check(page, "sign-up", width)
    ctx.close()
    return mock


def run_signed_in(browser, width, diet=False):
    tag = "diet-" if diet else ""
    mock = MockBackend(diet=diet)
    ctx = browser.new_context(viewport={"width": width, "height": HEIGHT}, geolocation={"latitude": 37.77, "longitude": -122.41}, permissions=["geolocation"])
    mock.install(ctx, signed_in=True)
    page = ctx.new_page()
    page.goto(f"{BASE}/explore", wait_until="domcontentloaded", timeout=180000)
    try:
        page.wait_for_selector("text=Bella Notte", timeout=120000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"explore-NOLOAD-{width}.png"))
        raise
    check(page, f"{tag}explore", width)

    # open a restaurant and look at its menu: the list, then the grid
    page.get_by_text("Taco Loco", exact=False).first.click()
    page.wait_for_selector("text=Menu Items For You", timeout=120000)
    settle(page, 1500)
    check(page, f"{tag}restaurant first-visit window", width)
    # the first-visit disclaimer window covers the menu until it is dismissed
    try:
        page.get_by_text("OK, got it", exact=True).click(timeout=5000)
    except Exception:
        pass
    settle(page, 700)
    check(page, f"{tag}restaurant list", width)
    # the ingredient notice is pinned: it stays exactly where it is while the menu scrolls far down
    notice = page.get_by_text("Dish names don't show every ingredient", exact=False).first
    before = notice.bounding_box()
    page.mouse.move(width / 2, HEIGHT / 2)
    page.mouse.wheel(0, 2500)
    settle(page, 800)
    after = notice.bounding_box()
    pinned = bool(before and after and abs(before["y"] - after["y"]) < 2 and 0 <= after["y"] <= HEIGHT and after["x"] >= -1 and after["x"] + after["width"] <= width + 1)
    report(f"{tag}ingredient notice stays on screen while scrolling", width, [] if pinned else [{"before": before, "after": after}])
    page.mouse.wheel(0, -2500)
    settle(page, 500)
    page.get_by_text("Quick view", exact=False).first.click()
    settle(page, 900)
    check(page, f"{tag}restaurant grid", width)
    # open the first tile's details (a tap anywhere on a tile that is not a button)
    page.get_by_text("Tap for details", exact=False).first.click()
    settle(page, 700)
    check(page, f"{tag}restaurant grid open", width)
    page.get_by_text("Detailed", exact=False).first.click()
    settle(page, 600)
    page.get_by_text("Quick take", exact=False).first.click()
    settle(page, 1500)
    check(page, f"{tag}restaurant list AI verdict", width)

    if not diet:
        for route, text in (("/saved", None), ("/chat", None), ("/profile", None), ("/help", None)):
            page.goto(f"{BASE}{route}", wait_until="domcontentloaded", timeout=120000)
            settle(page, 1500)
            check(page, route.strip("/"), width)
    problems = mock.touched_a_backend()
    ctx.close()
    return mock, problems


def main():
    only = os.environ.get("E2E_ONLY")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        touched = []
        unknown = set()
        for width in WIDTHS:
            if not only or only == "signed_out":
                run_signed_out(browser, width)
            if not only or only == "signed_in":
                mock, problems = run_signed_in(browser, width)
                touched += problems
                unknown |= set(mock.unknown_calls())
            if (not only or only == "diet") and width in (375, 768):
                mock, problems = run_signed_in(browser, width, diet=True)
                touched += problems
        browser.close()
    print()
    if unknown:
        print("backend calls the mock did not know:", sorted(unknown))
    if touched:
        print("FAIL  a page tried to reach a real backend:", touched[:3])
        return 1
    print(f"{checked} checks, {len(failures)} failed" if failures else f"All {checked} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
