"""Whole worker against a pretend menu-crawl server and a pretend restaurant site, with a real Chromium.
Skipped when Chromium is not installed (playwright install chromium)."""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crawl_places  # noqa: E402
from egress_proxy import EgressProxy  # noqa: E402
from safety import UrlGuard  # noqa: E402

CARDS = "".join(
    f'<div class="card"><h3>{n}</h3><p>{c} Cal</p><p>Fresh {n.lower()} made daily with seasonal ingredients.</p></div>'
    for n, c in [("Carne Asada Taco", 210), ("Chicken Burrito", 640), ("Cheese Quesadilla", 520),
                 ("Guacamole and Chips", 380), ("Beef Enchiladas", 590), ("Tamale Plate", 450)]
)
MENU = f"<html><body><main><h2>Mains</h2><div>{CARDS}</div></main></body></html>".encode()
EMPTY = b"<html><body><main><h1>Welcome</h1><p>We are a family restaurant. Call us.</p></main></body></html>"


def start(handler):
    srv = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Site(BaseHTTPRequestHandler):
    def do_GET(self):
        # only /menu has dishes; every other page (the homepage the worker also reads, robots.txt, ...) has none
        body = MENU if self.path.split("?")[0] == "/menu" else EMPTY
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class OpenGuard(UrlGuard):
    """Test only: lets the pretend restaurant on 127.0.0.1 through."""
    async def check(self, url):
        return True, "", True

    async def allows(self, url):
        return True


class WorkerIntegration(unittest.TestCase):
    def run_worker(self, batches, cap=None):
        """batches: what each successive 'work' call returns (a list of jobs per call); later calls return nothing.
        cap: pretend menuCrawlMaxPerRun: the fake server hands out nothing once the run has `taken` that many."""
        posts, secrets = [], []
        remaining = list(batches)

        class Api(BaseHTTPRequestHandler):
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                secrets.append(self.headers.get("x-crawler-secret"))
                posts.append(payload)
                if payload["action"] == "work":
                    over = cap is not None and payload.get("taken", 0) >= cap
                    out = {"jobs": [] if over else (remaining.pop(0) if remaining else []), "maxPerRun": cap}
                else:
                    out = {"status": payload["status"], "itemCount": 6}
                body = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        api = start(Api)
        self.addCleanup(api.shutdown)
        os.environ["CRAWLER_URL"] = f"http://127.0.0.1:{api.server_port}/fn"
        os.environ["CRAWLER_SECRET"] = "x" * 30
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("CRAWLER_URL", "CRAWLER_SECRET")])

        with tempfile.TemporaryDirectory() as work:
            args = crawl_places.parse_args(["--work-dir", work, "--max-pages", "2", "--page-timeout", "40",
                                            "--restaurant-timeout", "100"])
            import asyncio
            try:
                code = asyncio.run(crawl_places.run(args, guard=OpenGuard(), proxy=EgressProxy(allowed=lambda ip, port: True)))
            except Exception as e:
                if "Executable doesn't exist" in str(e):
                    self.skipTest("Chromium is not installed")
                raise
            leftovers = list(Path(work).iterdir())
        return code, posts, secrets, leftovers

    def test_reads_the_menu_and_reports_the_dishes_for_the_right_place(self):
        site = start(Site)
        self.addCleanup(site.shutdown)
        job = {"placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4", "name": "Cactus Grill", "link": f"http://127.0.0.1:{site.server_port}/menu"}
        code, posts, secrets, leftovers = self.run_worker([[job]])

        self.assertEqual(code, 0)
        # it asks again after each batch until nothing is left
        self.assertEqual([p["action"] for p in posts], ["work", "result", "work"])
        self.assertEqual(posts[0]["limit"], 5)
        result = posts[1]
        self.assertEqual((result["placeId"], result["link"], result["status"]), (job["placeId"], job["link"], "ok"))
        self.assertEqual(result["names"], ["Carne Asada Taco", "Chicken Burrito", "Cheese Quesadilla",
                                           "Guacamole and Chips", "Beef Enchiladas", "Tamale Plate"])
        # the menu text goes along, for the server's AI to read the dishes (and the page's calories) from
        self.assertIn("Carne Asada Taco | 210 Cal", result["text"])
        self.assertIn("Tamale Plate | 450 Cal", result["text"])
        self.assertNotIn("SOURCE:", result["text"])
        self.assertEqual(set(secrets), {"x" * 30})
        self.assertEqual(leftovers, [], "the saved pages are cleaned up")

    def test_a_page_with_no_dish_list_is_reported_as_no_items(self):
        site = start(Site)
        self.addCleanup(site.shutdown)
        job = {"placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4", "name": "Cactus Grill", "link": f"http://127.0.0.1:{site.server_port}/empty"}
        code, posts, _, _ = self.run_worker([[job]])
        self.assertEqual(code, 0)
        self.assertEqual(posts[1]["status"], "no_items")
        self.assertEqual((posts[1]["names"], posts[1]["text"]), ([], ""))

    def test_works_through_everything_that_is_waiting_in_one_run(self):
        site = start(Site)
        self.addCleanup(site.shutdown)
        base = f"http://127.0.0.1:{site.server_port}"
        jobs = [{"placeId": f"ChIJtestplace{i:08d}", "name": f"Place {i}", "link": f"{base}/menu"} for i in range(3)]
        code, posts, _, _ = self.run_worker([jobs[:2], jobs[2:]])
        self.assertEqual(code, 0)
        self.assertEqual([p["action"] for p in posts], ["work", "result", "result", "work", "result", "work"])
        results = [p for p in posts if p["action"] == "result"]
        self.assertEqual([r["placeId"] for r in results], [j["placeId"] for j in jobs])
        self.assertTrue(all(r["status"] == "ok" for r in results))

    def test_the_worker_tells_the_server_how_many_it_has_taken_and_stops_at_the_servers_limit(self):
        site = start(Site)
        self.addCleanup(site.shutdown)
        base = f"http://127.0.0.1:{site.server_port}"
        jobs = [{"placeId": f"ChIJcappedplace{i:06d}", "name": f"Place {i}", "link": f"{base}/menu"} for i in range(4)]
        code, posts, _, _ = self.run_worker([jobs[:1], jobs[1:2], jobs[2:3], jobs[3:]], cap=2)
        self.assertEqual(code, 0)
        works = [p for p in posts if p["action"] == "work"]
        self.assertEqual([w["taken"] for w in works], [0, 1, 2])
        results = [p for p in posts if p["action"] == "result"]
        self.assertEqual(len(results), 2, "only the first two restaurants are read; the rest wait for the next run")

    def test_nothing_to_do_posts_no_result(self):
        code, posts, _, _ = self.run_worker([])
        self.assertEqual(code, 0)
        self.assertEqual([p["action"] for p in posts], ["work"])

    def test_a_run_with_nothing_waiting_never_starts_the_browser(self):
        from unittest import mock
        with mock.patch.object(crawl_places.Session, "_start", side_effect=AssertionError("the browser was started")) as start:
            code, posts, _, _ = self.run_worker([])
        self.assertEqual(code, 0)
        self.assertEqual([p["action"] for p in posts], ["work"])
        start.assert_not_called()


class StrictDefaults(unittest.TestCase):
    def test_links_to_the_machine_itself_or_its_network_are_refused_by_the_real_guard(self):
        import asyncio
        guard = UrlGuard()
        for link in ("http://10.0.0.5/menu", "http://192.168.1.20/menu", "http://169.254.169.254/latest/meta-data/",
                     "http://127.0.0.1/menu", "http://[::1]/menu"):
            ok, reason, permanent = asyncio.run(guard.check(link))
            self.assertEqual((ok, permanent), (False, True), link)
            self.assertIn("private", reason, link)
        ok, reason, permanent = asyncio.run(guard.check("http://127.0.0.1:54321/menu"))
        self.assertEqual((ok, permanent), (False, True))      # also refused for its port


if __name__ == "__main__":
    unittest.main()
