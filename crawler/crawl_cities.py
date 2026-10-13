#!/usr/bin/env python3
"""crawl_cities.py - find independent restaurants in the cities an admin added (run by cron on the VPS).

What it does, each run
----------------------
1. Asks the server (the city-crawl edge function) for the next city that is waiting (admin page: Tools -> City Imports).
2. Searches that city, ONE Google Places request at a time, by calling the same function again and again. The server makes
   the Google request (it holds the key; this program holds no key), drops franchises, closed places and places that
   already have a menu, and queues each remaining restaurant's website for the menu crawler (crawl_places.py), which reads
   the menu exactly as it does for an owner's link. The server counts every Google request for the city.
3. Stops the city when it has found the number of restaurants the admin asked for, when Google has no more results, or when
   the city's request limit (the cityCrawlMaxCalls setting) is reached. Then it moves on to the next city.
4. At the end it asks the server to mark cities "done" whose restaurants have all been read.

It needs no browser. It shares the secret and the address style of crawl_places.py (CRAWLER_SECRET, CRAWLER_URL); the city
address is CITY_CRAWLER_URL, or CRAWLER_URL with /menu-crawl changed to /city-crawl.

Setup and the cron line: see README.md.

Check the Google key and what a search returns for a city, without recording anything:
    python crawl_cities.py --preview Austin --region TX
"""

import argparse
import asyncio
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

LOCK_FILE = "/tmp/pikme_crawl_cities.lock"
MAX_REQUESTS_PER_CITY = 1100        # a safety ceiling above the largest cityCrawlMaxCalls (1000)


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


def city_url() -> str:
    """The city-crawl address: CITY_CRAWLER_URL, or CRAWLER_URL with /menu-crawl swapped for /city-crawl."""
    explicit = os.environ.get("CITY_CRAWLER_URL", "").strip()
    if explicit:
        return explicit
    base = os.environ.get("CRAWLER_URL", "").strip().rstrip("/")
    if not base:
        return ""
    return base[: -len("/menu-crawl")] + "/city-crawl" if base.endswith("/menu-crawl") else base


def describe_error(exc: Exception) -> str:
    """A short message that never includes a header or a key."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"the server answered {exc.response.status_code}"
    return f"{type(exc).__name__}: {str(exc)[:120]}"


class Api:
    """The city-crawl edge function."""

    def __init__(self, url: str, secret: str, anon_key: str = "", client: httpx.AsyncClient = None):
        self.url, self.secret, self.anon_key, self.client = url, secret, anon_key, client

    def headers(self) -> dict:
        h = {"Content-Type": "application/json", "x-crawler-secret": self.secret}
        if self.anon_key:                       # needed when the function checks the caller's JWT
            h["apikey"] = self.anon_key
            h["Authorization"] = f"Bearer {self.anon_key}"
        return h

    async def call(self, payload: dict) -> dict:
        r = await self.client.post(self.url, json=payload, headers=self.headers(), timeout=90)
        r.raise_for_status()
        return r.json()

    async def work(self):
        """Returns (the next city or None, the per-city request limit or None)."""
        data = await self.call({"action": "work"})
        return data.get("job"), data.get("callLimit")

    async def discover(self, city_id: str) -> dict:
        return await self.call({"action": "discover", "cityId": city_id})

    async def fail(self, city_id: str, detail: str) -> dict:
        return await self.call({"action": "fail", "cityId": city_id, "detail": detail[:300]})

    async def sync(self) -> int:
        return int((await self.call({"action": "sync"})).get("updated", 0))

    async def preview(self, name: str, region: str) -> dict:
        return await self.call({"action": "preview", "name": name, "region": region})


async def search_city(api: Api, job: dict, call_limit, deadline: float, verbose: bool = False) -> dict:
    """Searches one city until the server says it is finished. Returns a summary:
    {"outcome": "finished" | "failed" | "timed_out", "requests": n, "counted": n or None, "stop": reason or None}."""
    requests, counted, stop = 0, None, None
    ceiling = min(MAX_REQUESTS_PER_CITY, (int(call_limit) + 5) if call_limit else MAX_REQUESTS_PER_CITY)
    while True:
        if time.monotonic() >= deadline:
            # left "discovering": the server hands the city out again after 30 minutes and it continues where it stopped
            return {"outcome": "timed_out", "requests": requests, "counted": counted, "stop": None}
        if requests >= ceiling:
            await api.fail(job["id"], f"stopped by the program after {requests} requests without finishing")
            return {"outcome": "failed", "requests": requests, "counted": counted, "stop": None}
        answer = await api.discover(job["id"])
        requests += 1
        counted = answer.get("counted", counted)
        if answer.get("error"):
            # the server already recorded the failure (and the request that failed)
            return {"outcome": "failed", "requests": requests, "counted": counted, "stop": None, "error": answer["error"]}
        if verbose:
            log(f"  {job['name']}: request {requests}, {counted} counted so far")
        if answer.get("finished"):
            stop = answer.get("stopReason")
            return {"outcome": "finished", "requests": requests, "counted": counted, "stop": stop}


async def run(args) -> int:
    url, secret = city_url(), os.environ.get("CRAWLER_SECRET", "")
    if not url or not secret:
        log("CRAWLER_URL (or CITY_CRAWLER_URL) and CRAWLER_SECRET must be set (environment or --env-file)")
        return 2

    async with httpx.AsyncClient() as http:
        api = Api(url, secret, os.environ.get("SUPABASE_ANON_KEY", ""), http)

        if args.preview:
            try:
                answer = await api.preview(args.preview, args.region or "")
            except Exception as e:
                log(f"preview failed ({describe_error(e)})")
                return 1
            if answer.get("error"):
                log(f"Google: {answer['error']}")
                return 1
            places = answer.get("places", [])
            log(f"{answer.get('query')}: {len(places)} places on the first page (nothing recorded)")
            for p in places:
                log(f"  {p.get('name')} | {p.get('address') or '-'} | {p.get('website') or 'NO WEBSITE'}"
                    f"{'' if p.get('open', True) else ' | NOT OPEN'}")
            return 0

        started = time.monotonic()
        deadline = started + args.max_minutes * 60
        cities, total_requests = 0, 0
        while cities < args.max_cities and time.monotonic() < deadline:
            try:
                job, call_limit = await api.work()
            except Exception as e:
                log(f"could not ask for work ({describe_error(e)})")
                break
            if not job:
                break
            cities += 1
            log(f"{job['name']}{', ' + job['region'] if job.get('region') else ''}: searching for up to {job['max']} restaurants")
            try:
                result = await search_city(api, job, call_limit, deadline, args.verbose)
            except Exception as e:                          # one bad city must not stop the rest
                result = {"outcome": "failed", "requests": 0, "counted": None, "stop": None, "error": describe_error(e)}
                try:
                    await api.fail(job["id"], result["error"])
                except Exception as e2:
                    log(f"{job['name']}: could not report the failure ({describe_error(e2)})")
            total_requests += result["requests"]
            if result["outcome"] == "finished":
                log(f"{job['name']}: {result['counted']} restaurant(s) found for the crawler, {result['requests']} Google request(s) "
                    f"this run, stopped because: {result['stop']}")
            elif result["outcome"] == "timed_out":
                log(f"{job['name']}: run time limit reached after {result['requests']} request(s); it continues in a later run")
            else:
                log(f"{job['name']}: failed ({result.get('error', 'see the City Imports page')}); it is retried later")

        try:
            updated = await api.sync()
            if updated:
                log(f"{updated} city(ies) marked done: all their restaurants have been read")
        except Exception as e:
            log(f"could not update city statuses ({describe_error(e)})")

        if cities == 0:
            log("no city is waiting")
        else:
            log(f"done: {cities} city(ies), {total_requests} Google request(s)")
    return 0


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Find independent restaurants in the cities added on the admin City Imports page.")
    ap.add_argument("--env-file", help="file with CRAWLER_URL (or CITY_CRAWLER_URL), CRAWLER_SECRET and optionally SUPABASE_ANON_KEY")
    ap.add_argument("--max-cities", type=int, default=5, help="most cities to search in one run (default 5)")
    ap.add_argument("--max-minutes", type=int, default=60, help="stop taking new work after this many minutes (default 60)")
    ap.add_argument("--preview", metavar="CITY", help="run one search for this city and print what comes back; records nothing")
    ap.add_argument("--region", default="", help="state or country for --preview, e.g. TX")
    ap.add_argument("--verbose", action="store_true", help="print every request")
    args = ap.parse_args(argv)
    args.max_cities = max(1, args.max_cities)
    args.max_minutes = max(1, args.max_minutes)
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.env_file:
        load_env_file(args.env_file)

    lock = None
    if not args.preview:
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
