"""A stand-in for the Supabase backend, used by the admin browser tests (Playwright). It answers the app's calls with made-up data, so the
real page code runs in a real browser without a login and without touching the real database.

It mimics what the server functions do for the pages under test (filters, source, paging); it does NOT test the SQL itself, which has
its own tests in supabase/tests.

Usage:  mock = MockBackend(); mock.install(context)   # then open pages that talk to http://localhost:9199
"""

import json
import re
from urllib.parse import urlparse

MOCK_ORIGIN = "http://localhost:9199"

CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "*",
}


def _restaurants():
    """A small nation: 60 claimed + city restaurants in Austin TX (to test paging), a few elsewhere."""
    rows = []

    def add(name, city, state, source, verified, unverified, status="approved", read=None, place=None, franchise=False):
        n = len(rows) + 1
        rows.append({
            "restaurant_id": None if source == "city" else f"00000000-0000-0000-0000-{n:012d}",
            "restaurant_name": name,
            "status": None if source == "city" else status,
            "since": f"2026-09-{(n % 27) + 1:02d}T10:00:00Z",
            "place_id": place or f"ChIJmock{n:014d}",
            "address": f"{n} Main St, {city}, {state} 7{n:04d}, USA" if city else "Somewhere without a state",
            "is_franchise": franchise,
            "city": city, "state": state, "source": source, "read_status": read,
            "verified_count": verified, "unverified_count": unverified,
        })

    for i in range(1, 61):
        add(f"Austin Imported {i:02d}", "Austin", "TX", "city", verified=i, unverified=i % 3)
    for i in range(1, 11):
        add(f"Austin Waiting {i:02d}", "Austin", "TX", "city", 0, 0, read="pending")
    add("Austin Empty Site", "Austin", "TX", "city", 0, 0, read="no_items")
    add("Austin Claimed Cafe", "Austin", "TX", "claimed", 30, 0)
    add("Austin Claimed Grill", "Austin", "TX", "claimed", 12, 14)
    add("Austin Claimed Empty", "Austin", "TX", "claimed", 0, 0, status="pending")
    for i in range(1, 4):
        add(f"Dallas Imported {i}", "Dallas", "TX", "city", 5, 1)
    add("Dallas Claimed", "Dallas", "TX", "claimed", 8, 2)
    add("Portland Oregon Bistro", "Portland", "OR", "claimed", 9, 3)
    add("Portland Maine Diner", "Portland", "ME", "claimed", 4, 4)
    add("St. Louis Imported", "St. Louis", "MO", "city", 7, 0)
    add("Nowhere Diner", None, None, "claimed", 0, 0)
    return rows


class MockBackend:
    def __init__(self, fail=()):
        self.fail = set(fail)    # report functions that answer with a permission error, to test the page's failure message
        self.restaurants = _restaurants()
        self.calls = []          # (rpc name, body) for every call the page made
        self.blocked = []        # requests to anywhere else (never sent): a real backend must never be reached

    # ---- the report functions, as the server answers them -------------------------------------------------------------------------
    def _scope(self, body):
        state = (body.get("p_state") or "").strip().lower()
        city = (body.get("p_city") or "").strip().lower()
        source = (body.get("p_source") or "").strip().lower()
        franchise = (body.get("p_franchise") or "").strip().lower()
        out = []
        for r in self.restaurants:
            if state == "__none__":
                if r["state"] is not None:
                    continue
            elif state and (r["state"] or "").lower() != state:
                continue
            if city and (r["city"] or "").lower() != city:
                continue
            if source and r["source"] != source:
                continue
            if franchise == "franchise" and not r["is_franchise"]:
                continue
            if franchise == "independent" and r["is_franchise"]:
                continue
            out.append(r)
        return out

    @staticmethod
    def _page(rows, body):
        limit = min(max(int(body.get("p_limit") or 50), 1), 200)
        offset = max(int(body.get("p_offset") or 0), 0)
        return rows[offset:offset + limit]

    def answer(self, name, body):
        if name == "admin_menu_health_locations":
            groups = {}
            for r in self.restaurants:
                groups[(r["state"], r["city"])] = groups.get((r["state"], r["city"]), 0) + 1
            return [{"state": s, "city": c, "restaurant_count": n} for (s, c), n in groups.items()]
        if name == "admin_report_menu_health_snapshot":
            rows = self._scope(body)
            return [{
                "verified_count": sum(r["verified_count"] for r in rows),
                "unverified_count": sum(r["unverified_count"] for r in rows),
                "restaurants_with_no_items_count": sum(1 for r in rows if r["verified_count"] + r["unverified_count"] == 0),
                "restaurant_count": len(rows),
            }]
        if name == "admin_report_menu_health_by_restaurant":
            scoped = self._scope(body)
            if body.get("p_no_items"):
                rows = sorted((r for r in scoped if r["verified_count"] + r["unverified_count"] == 0), key=lambda r: (r["since"], r["restaurant_name"].lower()))
            else:
                rows = sorted((r for r in scoped if r["verified_count"] + r["unverified_count"] > 0), key=lambda r: r["restaurant_name"].lower())
            return [dict(r, total_count=len(rows)) for r in self._page(rows, body)]
        return []

    # ---- wiring --------------------------------------------------------------------------------------------------------------------
    def _handle(self, route):
        request = route.request
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=CORS)
            return
        path = urlparse(request.url).path
        match = re.match(r"^/rest/v1/rpc/([A-Za-z0-9_]+)$", path)
        if match:
            try:
                body = json.loads(request.post_data or "{}")
            except ValueError:
                body = {}
            self.calls.append((match.group(1), body))
            if match.group(1) in self.fail:
                route.fulfill(status=403, headers={**CORS, "content-type": "application/json"},
                              body=json.dumps({"code": "42501", "message": f"permission denied for function {match.group(1)}"}))
                return
            payload = self.answer(match.group(1), body)
            route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps(payload))
            return
        # anything else the app asks for (sign-in checks, other tables) gets an empty answer
        if path.startswith("/auth/v1/"):
            route.fulfill(status=401, headers={**CORS, "content-type": "application/json"}, body=json.dumps({"message": "no session in tests"}))
            return
        route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body="[]")

    def _dispatch(self, route):
        """Only the app itself (localhost) and the mock are reachable; everything else is refused and recorded."""
        url = route.request.url
        host = urlparse(url).netloc
        if url.startswith(MOCK_ORIGIN):
            self._handle(route)
        elif host.startswith("localhost:") or host.startswith("127.0.0.1:"):
            route.continue_()
        else:
            self.blocked.append(url)
            route.abort()

    def install(self, context):
        context.route("**/*", self._dispatch)

    def touched_a_backend(self):
        """True if the page tried to reach any backend other than the mock (Supabase paths on another host)."""
        return [u for u in self.blocked if any(part in u for part in ("/rest/v1/", "/auth/v1/", "/functions/v1/", "supabase"))]

    def rpc_calls(self, name):
        return [body for (n, body) in self.calls if n == name]
