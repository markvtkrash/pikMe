"""Proves the overflow detector in test_responsive.py works: it must flag an element that sticks out past the right edge and a container that scrolls
sideways, and must stay quiet on a page that fits. Run it with the customer app serving (see test_responsive.py)."""

import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mock_backend import MockBackend  # noqa: E402
from test_responsive import OVERFLOW_JS, BASE  # noqa: E402


def main():
    mock = MockBackend()
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 375, "height": 800})
        mock.install(ctx, signed_in=False)
        page = ctx.new_page()
        page.goto(f"{BASE}/sign-in", wait_until="domcontentloaded", timeout=180000)
        page.wait_for_selector("text=Sign in to your account", timeout=120000)
        page.wait_for_timeout(800)

        clean = page.evaluate(OVERFLOW_JS)
        print(("PASS  " if not clean else "FAIL  ") + f"a page that fits reports nothing ({clean[:2]})")
        failures += bool(clean)

        page.evaluate("""() => {
          const wide = document.createElement('div');
          wide.id = 'wide'; wide.textContent = 'too wide';
          wide.style.cssText = 'width:600px;height:20px;position:relative;background:red';
          document.getElementById('root').appendChild(wide);
          const scroller = document.createElement('div');
          scroller.id = 'scroller';
          scroller.style.cssText = 'width:300px;overflow-x:auto;white-space:nowrap';
          scroller.innerHTML = '<div style="width:900px;height:20px;background:blue">chips chips chips</div>';
          document.getElementById('root').appendChild(scroller);
        }""")
        found = page.evaluate(OVERFLOW_JS)
        kinds = {f["kind"] for f in found}
        for kind in ("sticks out", "scrolls sideways"):
            ok = kind in kinds
            print(("PASS  " if ok else "FAIL  ") + f"the detector flags: {kind}")
            failures += not ok
        browser.close()
    print("detector OK" if not failures else f"{failures} detector check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
