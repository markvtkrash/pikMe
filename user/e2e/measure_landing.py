"""How much of a restaurant's menu shows on the first screen, before any scrolling: where the first dish starts and how many dishes are fully visible
above the pinned notice. Run it with the customer app serving (see README.md):  python e2e/measure_landing.py"""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mock_backend import MockBackend, menu_rows  # noqa: E402

BASE = os.environ.get("USER_APP_URL", "http://localhost:9102")
SHOTS = Path(os.environ.get("E2E_SHOTS", Path(__file__).resolve().parent / "screenshots"))
SHOTS.mkdir(parents=True, exist_ok=True)
SCREENS = [(320, 640), (375, 667), (375, 800), (390, 844), (414, 896)]   # small phone ... large phone
NAMES = [r["name"] for r in menu_rows("x")]

MEASURE_JS = """
(names) => {
  const H = window.innerHeight;
  // the pinned notice at the bottom of the sheet
  let noticeTop = H;
  for (const el of document.querySelectorAll('div')) {
    if ((el.innerText || '').startsWith("Dish names don't show every ingredient") && el.children.length <= 1) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < noticeTop) noticeTop = r.top;
    }
  }
  const found = [];
  for (const name of names) {
    const hit = Array.from(document.querySelectorAll('div,span')).find((e) => e.children.length === 0 && (e.innerText || '').trim() === name);
    if (!hit) continue;
    // the card is the nearest ancestor with a border
    let card = hit;
    for (let p = hit; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderRadius) >= 12) { card = p; break; } }
    const r = card.getBoundingClientRect();
    found.push({ name, top: Math.round(r.top), bottom: Math.round(r.bottom) });
  }
  found.sort((a, b) => a.top - b.top || 0);
  const visible = found.filter((f) => f.top >= 0 && f.bottom <= noticeTop + 1);
  const partly = found.filter((f) => f.top < noticeTop && f.bottom > noticeTop + 1 && f.top >= 0);
  return { viewport: H, noticeTop: Math.round(noticeTop), firstTop: found.length ? found[0].top : null, fullyVisible: visible.length, partlyVisible: partly.length };
}
"""


def open_menu(page, grid):
    page.goto(f"{BASE}/explore", wait_until="domcontentloaded", timeout=180000)
    page.wait_for_selector("text=Bella Notte", timeout=120000)
    page.get_by_text("Taco Loco", exact=False).first.click()
    page.wait_for_selector("text=Menu Items For You", timeout=120000)
    page.wait_for_timeout(1500)
    try:
        page.get_by_text("OK, got it", exact=True).click(timeout=5000)
    except Exception:
        pass
    page.wait_for_timeout(800)
    # choose the layout through the saved choice, then reopen so it applies from the start
    page.get_by_text("Quick view" if grid else "Detailed", exact=False).first.click()
    page.wait_for_timeout(900)


def main():
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for (w, h) in SCREENS:
            for grid in (False, True):
                mock = MockBackend()
                ctx = browser.new_context(viewport={"width": w, "height": h}, geolocation={"latitude": 37.77, "longitude": -122.41}, permissions=["geolocation"])
                mock.install(ctx, signed_in=True)
                page = ctx.new_page()
                open_menu(page, grid)
                m = page.evaluate(MEASURE_JS, NAMES)
                page.screenshot(path=str(SHOTS / f"landing-{w}x{h}-{'grid' if grid else 'list'}.png"))
                rows.append((w, h, "grid" if grid else "list", m))
                print(f"{w}x{h:<4} {'grid' if grid else 'list'}:  first dish starts at {m['firstTop']}px of {m['viewport']}px;  "
                      f"{m['fullyVisible']} dish(es) fully visible, {m['partlyVisible']} partly (the pinned notice starts at {m['noticeTop']}px)")
                ctx.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
