#!/usr/bin/env python3
"""Menu agent courier. Run by cron on the VPS.

It asks the menu-agent edge function for a job, then loops: do the instruction it was given (open a page, read a PDF),
report what was seen, and receive the next instruction. The server (and its AI) decides where to go; this script only
carries out four kinds of instruction (open_page, read_pdf, read_image, done) and refuses anything else.

Every address is checked by safety.py and robots.txt before it is opened. The only secret held here is the crawler
secret; the AI key stays in the edge function.
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urljoin, urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

import menu_reader  # noqa: E402
from crawl_places import Session, acquire_lock, load_env_file, log  # noqa: E402
from safety import UrlGuard  # noqa: E402

LOCK_FILE = "/tmp/pikme_crawl_agent.lock"
MAX_TEXT = 12000
MAX_LINKS = 60
KNOWN = ("open_page", "read_pdf", "read_image", "done")


def fail(reason: str) -> dict:
    return {"ok": False, "reason": reason, "text": "", "links": [], "pdfs": [], "images": []}


class AgentApi:
    """The menu-agent edge function."""

    def __init__(self, url: str, secret: str, anon_key: str = "", client: httpx.AsyncClient = None):
        self.url, self.secret, self.anon_key, self.client = url, secret, anon_key, client

    def headers(self) -> dict:
        h = {"Content-Type": "application/json", "x-crawler-secret": self.secret}
        if self.anon_key:
            h["apikey"] = self.anon_key
            h["Authorization"] = f"Bearer {self.anon_key}"
        return h

    async def call(self, payload: dict) -> dict:
        r = await self.client.post(self.url, json=payload, headers=self.headers(), timeout=180)
        r.raise_for_status()
        return r.json()

    async def work(self) -> dict:
        return await self.call({"action": "work"})

    async def step(self, job_id: int, url: str, result: dict, items: list) -> dict:
        return await self.call({"action": "step", "jobId": job_id, "url": url, "result": result, "items": items})


async def checked(guard: UrlGuard, http, url: str):
    """None when the address may be opened, otherwise the short reason it may not."""
    allowed, reason, _permanent = await guard.check(url)
    if not allowed:
        return f"blocked: {reason}"[:100]
    if not await menu_reader.allowed(http, url):
        return "robots"
    return None


async def open_page(browser, http, guard: UrlGuard, url: str, page_timeout: int) -> dict:
    """Opens one page in a fresh browser context and returns what was seen: text, same-page links, PDF and image links."""
    why = await checked(guard, http, url)
    if why:
        return fail(why)
    context = await browser.new_context(user_agent=menu_reader.USER_AGENT, locale="en-US",
                                        viewport={"width": 1366, "height": 900})

    async def route(r):
        if r.request.resource_type in ("image", "media", "font"):
            await r.abort()
        elif not await guard.allows(r.request.url):
            await r.abort()
        else:
            await r.continue_()
    await context.route("**/*", route)
    try:
        page = await menu_reader.limited(context.new_page(), 30)
        await menu_reader.limited(page.goto(url, wait_until="domcontentloaded", timeout=page_timeout * 1000), page_timeout + 10)
        await asyncio.sleep(1.5)
        read = await menu_reader.expand_and_read(page)
        raw_links = await menu_reader.limited(page.eval_on_selector_all("a[href]", menu_reader.LINKS_JS), 20)
        raw_imgs = await menu_reader.limited(page.eval_on_selector_all(
            "img[src]", "els => els.map(e => e.currentSrc || e.src)"), 20)
        final = page.url
    except Exception as e:
        return fail(menu_reader.err_text(e, 100))
    finally:
        await context.close()

    links, pdfs = [], []
    for href, _text in raw_links:
        absolute = menu_reader.norm(urljoin(final, href))
        if urlparse(absolute).scheme not in ("http", "https"):
            continue
        (pdfs if absolute.lower().split("?")[0].endswith(".pdf") else links).append(absolute)
    images = [urljoin(final, s) for s in raw_imgs if urlparse(urljoin(final, s)).scheme in ("http", "https")]
    text = (read.get("menuText") or read.get("pageText") or "")[:MAX_TEXT]
    return {"ok": True, "reason": "", "text": text, "links": links[:MAX_LINKS], "pdfs": pdfs[:10], "images": images[:10]}


async def read_pdf(http, guard: UrlGuard, url: str) -> dict:
    """Downloads one PDF (size-limited) and returns its text. A scanned PDF has none: that is reported, not guessed."""
    why = await checked(guard, http, url)
    if why:
        return fail(why)
    try:
        async with http.stream("GET", url, timeout=60) as r:
            if r.status_code >= 400:
                return fail(f"http {r.status_code}")
            data = b""
            async for chunk in r.aiter_bytes():
                data += chunk
                if len(data) > menu_reader.MAX_PDF_BYTES:
                    return fail("pdf too big")
    except Exception as e:
        return fail(menu_reader.err_text(e, 100))
    text = menu_reader.pdf_text(data)
    if not text:
        return fail("pdf has no readable text")
    return {"ok": True, "reason": "", "text": text[:MAX_TEXT], "links": [], "pdfs": [], "images": []}


async def carry_out(session: Session, guard: UrlGuard, next_step: dict, page_timeout: int) -> dict:
    """Does one instruction from the server. Only the known kinds are run; anything else is refused."""
    kind, url = next_step.get("do"), next_step.get("url")
    if kind not in KNOWN or kind == "done" or not isinstance(url, str):
        return fail("instruction refused")
    browser, http = await session.ready()
    if kind == "open_page":
        return await open_page(browser, http, guard, url, page_timeout)
    if kind == "read_pdf":
        return await read_pdf(http, guard, url)
    return fail("reading images is not supported by this worker")      # read_image


async def run_job(api: AgentApi, session: Session, guard: UrlGuard, job: dict, first: dict, args) -> str:
    """Follows the server's instructions for one job until it says done. Returns a short outcome for the log."""
    job_id, next_step, items, steps = job["id"], first, [], 0
    while next_step.get("do") != "done":
        steps += 1
        if steps > args.hard_max_steps:           # the server limits steps too; this is a ceiling if it ever fails to
            return f"stopped by the local ceiling of {args.hard_max_steps} steps"
        url = next_step.get("url", "")
        result = await carry_out(session, guard, next_step, args.page_timeout)
        if args.verbose:
            log(f"  step {steps}: {next_step.get('do')} {url} -> {'ok' if result['ok'] else result['reason']}")
        answer = await api.step(job_id, url, result, items)
        next_step, items = answer.get("next") or {"do": "done"}, answer.get("items") or []
    return f"finished after {steps} step(s), {len(items)} dishes"


async def run(args, guard: UrlGuard = None) -> int:
    """guard is only replaced by the tests; a real run always uses the strict defaults."""
    url, secret = os.environ.get("CRAWLER_URL", ""), os.environ.get("CRAWLER_SECRET", "")
    if not url or not secret:
        log("CRAWLER_URL and CRAWLER_SECRET must be set (environment or --env-file)")
        return 2
    agent_url = os.environ.get("AGENT_URL") or url.rsplit("/", 1)[0] + "/menu-agent"
    guard = guard or UrlGuard()
    menu_reader.URL_GUARD = guard.allows
    menu_reader.PAGE_DELAY = 1.0
    session = Session(SimpleNamespace(headed=args.headed), guard)
    started, taken = time.monotonic(), 0
    try:
        async with httpx.AsyncClient() as api_http:
            api = AgentApi(agent_url, secret, os.environ.get("SUPABASE_ANON_KEY", ""), api_http)
            while taken < args.max_jobs and time.monotonic() - started < args.max_minutes * 60:
                data = await api.work()
                job = data.get("job")
                if not job:
                    break
                taken += 1
                log(f"{job['name']} [job {job['id']}]: starting at {data['next'].get('url')}")
                try:
                    outcome = await menu_reader.limited(
                        run_job(api, session, guard, job, data["next"], args), args.job_timeout)
                except Exception as e:             # one bad job must not stop the rest; the server re-issues it later
                    outcome = f"stopped: {menu_reader.err_text(e)}"
                log(f"{job['name']} [job {job['id']}]: {outcome}")
        log("nothing to do" if taken == 0 else f"done: {taken} job(s)")
        return 0
    finally:
        await session.close()


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Courier for the menu agent: carries out the server's instructions.")
    ap.add_argument("--env-file", help="file with CRAWLER_URL, CRAWLER_SECRET and optionally SUPABASE_ANON_KEY, AGENT_URL")
    ap.add_argument("--max-jobs", type=int, default=3, help="most jobs in one run (default 3)")
    ap.add_argument("--max-minutes", type=int, default=60, help="stop taking new jobs after this many minutes (default 60)")
    ap.add_argument("--job-timeout", type=int, default=900, help="seconds before giving up on one job (default 900)")
    ap.add_argument("--page-timeout", type=int, default=60, help="seconds before giving up on one page (default 60)")
    ap.add_argument("--hard-max-steps", type=int, default=50, help="local ceiling on steps per job (default 50)")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--verbose", action="store_true", help="print every step")
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.env_file:
        load_env_file(args.env_file)
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
