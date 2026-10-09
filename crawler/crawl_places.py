#!/usr/bin/env python3
"""crawl_places.py - read the menu link of independent restaurants in a real browser (run by cron on the VPS).

What it does, each run
----------------------
1. Asks the server (the menu-crawl edge function) which restaurants have a new owner or admin menu link to read.
   The server hands out a few at a time and remembers that they are taken, so overlapping runs never share one.
2. For each one it opens the link in Chromium (menu_reader.py: the same page reader as crawl_menus.py, which finds the
   menu by how it looks on screen and follows tabs, "load more", embedded data and API calls), staying on that
   restaurant's own site with a small page budget.
3. It sends the MENU TEXT it read (plus the dish names it parsed itself, as a fallback) back, together with the
   restaurant's Google place ID. The server's AI reads the dishes out of the text (and any calories the page states),
   estimates nutrition and ADDS the dishes to that exact restaurant's menu (new dishes verified, matching AI guesses
   confirmed, nothing replaced). A page it could not read is reported as an error and retried later; a page that was
   read but held no dish list is recorded and left alone until the link changes.

The worker never holds the database key or an AI key. It only has a secret that lets it ask for work and post results.
Every address it opens (including redirects) must resolve to a public internet address (safety.py).

Setup and the cron line: see README.md.

Manual test of the reader on one page, without contacting the server:
    python crawl_places.py --try https://example-restaurant.com/menu
"""

import argparse
import asyncio
import hashlib
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import httpx

import menu_reader
from egress_proxy import EgressProxy
from items import MIN_NAMES_FOR_OK, collect_names, collect_text, decide_status, page_card_names
from safety import UrlGuard

LOCK_FILE = "/tmp/pikme_crawl_places.lock"


def log(msg: str) -> None:
    print(f"{datetime.now().isoformat(timespec='seconds')} {msg}", flush=True)


def load_env_file(path: str) -> None:
    """KEY=VALUE lines (no quotes needed); existing environment variables win."""
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def folder_key(place_id: str) -> str:
    """A folder name for one restaurant, from its place ID (never from its name: two restaurants can share a name)."""
    return "place-" + hashlib.sha1(place_id.encode("utf-8")).hexdigest()[:16]


def clean_stale_folders(work_dir) -> int:
    """Deletes leftover place folders from a run that was killed. Only called at the start of a run, when the lock
    guarantees no other run is using them. Only folders this program makes (place-*) are touched."""
    removed = 0
    root = Path(work_dir)
    if not root.is_dir():
        return 0
    for child in root.iterdir():
        if child.is_dir() and child.name.startswith("place-"):
            shutil.rmtree(child, ignore_errors=True)
            removed += 1
    return removed


def acquire_lock(path: str):
    """Only one run at a time. Returns the open lock file, None where locking is unavailable, False if another run holds it."""
    try:
        import fcntl
    except ImportError:
        return None
    handle = open(path, "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False
    return handle


class Api:
    """The menu-crawl edge function."""

    def __init__(self, url: str, secret: str, anon_key: str = "", client: httpx.AsyncClient = None):
        self.url, self.secret, self.anon_key, self.client = url, secret, anon_key, client

    def headers(self) -> dict:
        h = {"Content-Type": "application/json", "x-crawler-secret": self.secret}
        if self.anon_key:                       # needed when the function checks the caller's JWT
            h["apikey"] = self.anon_key
            h["Authorization"] = f"Bearer {self.anon_key}"
        return h

    async def call(self, payload: dict) -> dict:
        r = await self.client.post(self.url, json=payload, headers=self.headers(), timeout=180)
        r.raise_for_status()
        return r.json()

    async def work(self, limit: int, taken: int = 0):
        """Asks for up to `limit` restaurants. `taken` is how many this run already has: the server stops handing out
        work when the run reaches its limit (the menuCrawlMaxPerRun setting). Returns (jobs, that limit or None)."""
        data = await self.call({"action": "work", "limit": limit, "taken": taken})
        return data.get("jobs", []), data.get("maxPerRun")

    async def result(self, job: dict, status: str, names: list, text: str, detail: str) -> dict:
        """names and text are sent only for status 'ok': the menu text for the server's AI to read the dishes from,
        and the dish names parsed here as a fallback."""
        ok = status == "ok"
        return await self.call({
            "action": "result", "placeId": job["placeId"], "link": job["link"], "status": status,
            "names": names if ok else [], "text": text if ok else "", "detail": detail[:300],
        })


async def read_link(browser, http, guard: UrlGuard, key: str, link: str, args):
    """Open one link and return (status, names, text, detail). status: ok / no_items / error.
    names are the dishes parsed here; text is the menu text the server's AI reads the dishes from."""
    allowed, reason, permanent = await guard.check(link)
    if not allowed:
        return ("no_items" if permanent else "error"), [], "", f"link refused: {reason}"

    p = urlparse(link)
    row = {"name": key, "website": f"{p.scheme}://{p.netloc}", "menu_url": link}
    try:
        manifest = await menu_reader.limited(
            menu_reader.crawl_restaurant(browser, http, row, args), args.restaurant_timeout)
    except asyncio.TimeoutError:
        return "error", [], "", f"gave up after {args.restaurant_timeout}s"

    folder = menu_reader.OUTPUT_DIR / menu_reader.slugify(key)
    names = collect_names(folder)
    text = collect_text(folder)
    # menu cards seen on the pages themselves; lines that came from the page's data do not count as a menu
    cards = len(page_card_names(folder))
    if cards >= MIN_NAMES_FOR_OK or len(names) >= MIN_NAMES_FOR_OK:
        return "ok", names, text, f"{cards} menu cards and {len(names)} dish names read"
    status, detail = decide_status(names, manifest)
    return status, [], "", detail


class Session:
    """The proxy, Playwright, the HTTP client and Chromium, started the first time a restaurant is about to be read.

    A run with nothing waiting (the usual case when cron fires every few minutes) therefore never launches a browser:
    it asks the server for work, hears "nothing", and exits.
    """

    def __init__(self, args, guard: UrlGuard, proxy: EgressProxy = None):
        self.args, self.guard, self.proxy = args, guard, proxy
        self.started = False
        self.pw_cm = self.pw = self.http = self.browser = None
        self.launch_options = None
        self.lock = asyncio.Lock()

    async def _start(self):
        from playwright.async_api import async_playwright

        async def block_unsafe(request):
            # runs for every plain-HTTP request, including each redirect hop
            if not await self.guard.allows(str(request.url)):
                raise httpx.RequestError(f"blocked address: {request.url.host}")

        # All web traffic (the browser's and the plain-HTTP fallback's) goes through a local filtering proxy that only
        # connects to public internet addresses. This is the real boundary; the checks elsewhere are early, friendly
        # refusals.
        self.proxy = self.proxy or EgressProxy()
        proxy_url = f"http://127.0.0.1:{await self.proxy.start()}"
        self.launch_options = dict(headless=not self.args.headed,
                                   proxy={"server": proxy_url, "bypass": "<-loopback>"})   # proxy loopback addresses too
        self.http = httpx.AsyncClient(
            headers=menu_reader.PLAIN_HEADERS, follow_redirects=True, http2=False, proxy=proxy_url,
            event_hooks={"request": [block_unsafe]})
        self.pw_cm = async_playwright()
        self.pw = await self.pw_cm.__aenter__()
        self.browser = await self.pw.chromium.launch(**self.launch_options)
        self.started = True

    async def ready(self):
        """(browser, http client), starting everything on first use and restarting a browser that has stopped."""
        async with self.lock:
            if not self.started:
                await self._start()
            elif not self.browser.is_connected():
                log("browser stopped responding; restarting it")
                self.browser = await self.pw.chromium.launch(**self.launch_options)
            return self.browser, self.http

    async def close(self):
        """Stops only what was started."""
        if self.browser is not None:
            try:
                await menu_reader.limited(self.browser.close(), 30)
            except Exception:
                pass
        if self.http is not None:
            try:
                await self.http.aclose()
            except Exception:
                pass
        if self.pw_cm is not None:
            try:
                await self.pw_cm.__aexit__(None, None, None)
            except Exception:
                pass
        if self.proxy is not None and self.started:
            await self.proxy.stop()


async def run(args, guard: UrlGuard = None, proxy: EgressProxy = None) -> int:
    """guard and proxy are only replaced by the tests; a real run always uses the strict defaults."""
    menu_reader.OUTPUT_DIR = Path(args.work_dir)
    menu_reader.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    menu_reader.PAGE_DELAY = 1.0
    menu_reader.SAVE_PDFS = False            # only text and JSON are used; a PDF would just fill the disk
    if not args.try_url and not args.keep:
        stale = clean_stale_folders(args.work_dir)
        if stale:
            log(f"removed {stale} leftover folder(s) from an earlier run that did not finish")
    guard = guard or UrlGuard()
    menu_reader.URL_GUARD = guard.allows
    crawl_args = SimpleNamespace(zip=None, max_pages=args.max_pages, verbose=args.verbose,
                                 page_timeout=args.page_timeout, restaurant_timeout=args.restaurant_timeout)
    session = Session(args, guard, proxy)

    try:
        # ── manual test: read one link, print the dishes, contact nobody ──
        if args.try_url:
            key = folder_key(args.try_url)
            browser, http = await session.ready()
            status, names, text, detail = await read_link(browser, http, guard, key, args.try_url, crawl_args)
            log(f"{status}: {detail}")
            for n in names:
                print(" -", n)
            if text:
                print(f"\n--- menu text that would be sent to the server ({len(text)} characters) ---")
                print(text[:4000] + ("\n..." if len(text) > 4000 else ""))
            log(f"files are in {menu_reader.OUTPUT_DIR / menu_reader.slugify(key)}")
            return 0

        # ── normal run ──
        url, secret = os.environ.get("CRAWLER_URL", ""), os.environ.get("CRAWLER_SECRET", "")
        if not url or not secret:
            log("CRAWLER_URL and CRAWLER_SECRET must be set (environment or --env-file)")
            return 2
        async with httpx.AsyncClient() as api_http:
            api = Api(url, secret, os.environ.get("SUPABASE_ANON_KEY", ""), api_http)
            sem = asyncio.Semaphore(max(1, args.workers))

            async def one(job):
                async with sem:
                    key = folder_key(job["placeId"])
                    started = time.monotonic()
                    try:
                        browser, http = await session.ready()      # the first restaurant starts the browser
                        status, names, text, detail = await read_link(browser, http, guard, key, job["link"], crawl_args)
                    except Exception as e:                       # one bad restaurant must not stop the rest
                        status, names, text, detail = "error", [], "", menu_reader.err_text(e)
                    try:
                        answer = await api.result(job, status, names, text, detail)
                        log(f"{job['name']} [{job['placeId']}]: {status}, {len(names)} dish names and "
                            f"{len(text)} characters of text sent "
                            f"in {time.monotonic() - started:.0f}s -> {answer.get('status')} ({answer.get('itemCount', 0)} added)")
                    except Exception as e:
                        # not reported: the server hands it out again after 30 minutes
                        log(f"{job['name']} [{job['placeId']}]: could not report the result ({menu_reader.err_text(e)})")
                    if not args.keep:
                        shutil.rmtree(menu_reader.OUTPUT_DIR / menu_reader.slugify(key), ignore_errors=True)

            # Work through what is waiting, a few restaurants at a time, until nothing is left or a limit is
            # reached. The main limit is the menuCrawlMaxPerRun setting (app_config), enforced by the server: it
            # stops handing out work once this run has taken that many, and the rest waits for the next run.
            # --max-total and --max-minutes are extra local ceilings. A restaurant saved again while this runs
            # is picked up in the same run.
            run_started, taken, server_cap = time.monotonic(), 0, None
            timed_out = lambda: time.monotonic() - run_started >= args.max_minutes * 60
            local_cap_hit = lambda: bool(args.max_total) and taken >= args.max_total
            while not timed_out() and not local_cap_hit():
                want = min(args.limit, args.max_total - taken) if args.max_total else args.limit
                jobs, server_cap = await api.work(want, taken)
                if not jobs:
                    break
                taken += len(jobs)
                log(f"{len(jobs)} restaurant(s) to read ({taken} so far)")
                await asyncio.gather(*(one(j) for j in jobs))
            if taken == 0:
                log("nothing to crawl")
            elif server_cap and taken >= server_cap:
                log(f"stopped after {taken} restaurant(s): the run limit (menuCrawlMaxPerRun = {server_cap}) was "
                    f"reached; anything still waiting is read by the next run")
            elif local_cap_hit() or timed_out():
                log(f"stopped after {taken} restaurant(s): a local limit (--max-total / --max-minutes) was reached; "
                    f"anything still waiting is read by the next run")
            else:
                log(f"done: {taken} restaurant(s) read")
        return 0
    finally:
        await session.close()


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Read the menu links of independent restaurants in a real browser.")
    ap.add_argument("--env-file", help="file with CRAWLER_URL, CRAWLER_SECRET and optionally SUPABASE_ANON_KEY")
    ap.add_argument("--limit", type=int, default=5, help="restaurants to ask for at a time (1-5, default 5)")
    ap.add_argument("--max-total", type=int, default=0,
                    help="an extra local ceiling on restaurants read in one run (default 0 = none; the main limit is the "
                         "menuCrawlMaxPerRun setting in app_config)")
    ap.add_argument("--max-minutes", type=int, default=240, help="stop taking new restaurants after this many minutes (default 240)")
    ap.add_argument("--workers", type=int, default=1, help="restaurants read at the same time (default 1)")
    ap.add_argument("--max-pages", type=int, default=6, help="pages read per restaurant (default 6)")
    ap.add_argument("--page-timeout", type=int, default=90, help="seconds before giving up on one page")
    ap.add_argument("--restaurant-timeout", type=int, default=300, help="seconds before giving up on one restaurant")
    ap.add_argument("--work-dir", default="work", help="where pages are saved while reading (default ./work)")
    ap.add_argument("--keep", action="store_true", help="keep the saved pages after a restaurant is done")
    ap.add_argument("--try", dest="try_url", help="read this one link and print the dishes; contacts no server")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--verbose", action="store_true", help="print every page as it is visited")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.env_file:
        load_env_file(args.env_file)
    args.limit = max(1, min(args.limit, 5))

    lock = None
    if not args.try_url:
        lock = acquire_lock(LOCK_FILE)
        if lock is False:
            log("another run is still going; leaving it to finish")
            return 3
    try:
        return asyncio.run(run(args))
    finally:
        if lock:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
