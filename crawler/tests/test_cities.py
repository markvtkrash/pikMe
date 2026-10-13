import asyncio
import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crawl_cities  # noqa: E402
from crawl_cities import Api, city_url, parse_args, search_city  # noqa: E402

REAL_CLIENT = httpx.AsyncClient
CITY = {"id": "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b", "name": "Austin", "region": "TX", "max": 100}


class FakeServer:
    """Plays the city-crawl edge function: records every call, answers from queues."""

    def __init__(self, cities=None, discover=None, call_limit=60, fail_status=None):
        self.cities = list(cities or [])
        self.discover_answers = list(discover or [])
        self.call_limit = call_limit
        self.fail_status = fail_status          # make 'discover' answer with this HTTP status
        self.calls = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.calls.append((body["action"], body, dict(request.headers)))
        action = body["action"]
        if action == "work":
            job = self.cities.pop(0) if self.cities else None
            return httpx.Response(200, json={"job": job, "callLimit": self.call_limit})
        if action == "discover":
            if self.fail_status:
                return httpx.Response(self.fail_status, json={"error": "Server error"})
            answer = self.discover_answers.pop(0) if self.discover_answers else {"finished": True, "stopReason": "ran_out_of_results", "counted": 0}
            return httpx.Response(200, json=answer)
        if action == "fail":
            return httpx.Response(200, json={"status": "error"})
        if action == "sync":
            return httpx.Response(200, json={"updated": 1})
        if action == "preview":
            return httpx.Response(200, json={"query": "restaurants in Austin, TX", "places": [
                {"name": "Alpha Cafe", "address": "1 Main St", "website": "https://alpha.example.com", "open": True},
                {"name": "No Site", "address": "2 Main St", "website": None, "open": True}]})
        return httpx.Response(400, json={"error": "Unknown action"})

    def actions(self):
        return [c[0] for c in self.calls]


def make_api(server):
    client = REAL_CLIENT(transport=httpx.MockTransport(server.handler))
    return Api("https://example.test/functions/v1/city-crawl", "s" * 30, "anon-key", client), client


def run_main(server, argv=None, env=None):
    """Runs crawl_cities.run against the fake server."""
    args = parse_args(argv or [])
    environ = {"CRAWLER_URL": "https://example.test/functions/v1/menu-crawl", "CRAWLER_SECRET": "s" * 30}
    environ.update(env or {})
    transport = httpx.MockTransport(server.handler)
    with mock.patch.dict(os.environ, environ, clear=False), \
         mock.patch.object(crawl_cities.httpx, "AsyncClient", lambda: REAL_CLIENT(transport=transport)):
        return asyncio.run(crawl_cities.run(args))


class CityUrl(unittest.TestCase):
    def test_swaps_the_function_name_in_crawler_url(self):
        with mock.patch.dict(os.environ, {"CRAWLER_URL": "http://localhost:8000/functions/v1/menu-crawl/", "CITY_CRAWLER_URL": ""}):
            self.assertEqual(city_url(), "http://localhost:8000/functions/v1/city-crawl")

    def test_an_explicit_address_wins(self):
        with mock.patch.dict(os.environ, {"CRAWLER_URL": "http://a/menu-crawl", "CITY_CRAWLER_URL": "http://b/city-crawl"}):
            self.assertEqual(city_url(), "http://b/city-crawl")

    def test_empty_when_nothing_is_set(self):
        with mock.patch.dict(os.environ, {"CRAWLER_URL": "", "CITY_CRAWLER_URL": ""}):
            self.assertEqual(city_url(), "")


class Arguments(unittest.TestCase):
    def test_defaults_and_floors(self):
        a = parse_args([])
        self.assertEqual((a.max_cities, a.max_minutes), (5, 60))
        b = parse_args(["--max-cities", "0", "--max-minutes", "-3"])
        self.assertEqual((b.max_cities, b.max_minutes), (1, 1))


class SearchCity(unittest.TestCase):
    def test_keeps_asking_until_the_server_says_finished(self):
        server = FakeServer(discover=[
            {"finished": False, "counted": 20}, {"finished": False, "counted": 41},
            {"finished": True, "stopReason": "reached_target", "counted": 100}])
        api, client = make_api(server)
        result = asyncio.run(search_city(api, CITY, 60, time.monotonic() + 60))
        asyncio.run(client.aclose())
        self.assertEqual(result, {"outcome": "finished", "requests": 3, "counted": 100, "stop": "reached_target"})
        self.assertEqual(server.actions(), ["discover"] * 3)
        self.assertEqual(server.calls[0][1]["cityId"], CITY["id"])

    def test_sends_the_secret_and_the_anon_key(self):
        server = FakeServer(discover=[{"finished": True, "stopReason": "call_limit", "counted": 7}])
        api, client = make_api(server)
        asyncio.run(search_city(api, CITY, 60, time.monotonic() + 60))
        asyncio.run(client.aclose())
        headers = server.calls[0][2]
        self.assertEqual(headers["x-crawler-secret"], "s" * 30)
        self.assertEqual(headers["apikey"], "anon-key")
        self.assertEqual(headers["authorization"], "Bearer anon-key")

    def test_a_failure_the_server_recorded_ends_the_city(self):
        server = FakeServer(discover=[{"finished": False, "counted": 5}, {"finished": True, "error": "Google refused the key", "counted": None}])
        api, client = make_api(server)
        result = asyncio.run(search_city(api, CITY, 60, time.monotonic() + 60))
        asyncio.run(client.aclose())
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["requests"], 2)
        self.assertEqual(result["error"], "Google refused the key")
        self.assertNotIn("fail", server.actions())      # the server already recorded it

    def test_gives_up_after_the_ceiling_and_reports_it(self):
        server = FakeServer(discover=[{"finished": False, "counted": 1}] * 50)
        api, client = make_api(server)
        result = asyncio.run(search_city(api, CITY, 3, time.monotonic() + 60))      # ceiling = 3 + 5 requests
        asyncio.run(client.aclose())
        self.assertEqual(result["outcome"], "failed")
        self.assertEqual(result["requests"], 8)
        self.assertEqual(server.actions().count("discover"), 8)
        self.assertEqual(server.actions()[-1], "fail")

    def test_stops_when_the_time_is_up_and_leaves_the_city_for_later(self):
        server = FakeServer(discover=[{"finished": False, "counted": 1}] * 5)
        api, client = make_api(server)
        result = asyncio.run(search_city(api, CITY, 60, time.monotonic() - 1))
        asyncio.run(client.aclose())
        self.assertEqual(result["outcome"], "timed_out")
        self.assertEqual(server.actions(), [])          # nothing was sent, nothing marked failed


class Run(unittest.TestCase):
    def test_searches_each_waiting_city_then_syncs(self):
        other = dict(CITY, id="aaaaaaaa-5a4d-4e6f-9a7b-1c2d3e4f5a6b", name="Dallas")
        server = FakeServer(cities=[CITY, other], discover=[
            {"finished": True, "stopReason": "reached_target", "counted": 100},
            {"finished": True, "stopReason": "ran_out_of_results", "counted": 12}])
        self.assertEqual(run_main(server), 0)
        self.assertEqual(server.actions(), ["work", "discover", "work", "discover", "work", "sync"])

    def test_respects_the_most_cities_per_run(self):
        cities = [dict(CITY, id=f"{i:08d}-5a4d-4e6f-9a7b-1c2d3e4f5a6b", name=f"Town{i}") for i in range(4)]
        server = FakeServer(cities=cities)
        run_main(server, ["--max-cities", "2"])
        self.assertEqual(server.actions().count("work"), 2)
        self.assertEqual(server.actions().count("discover"), 2)
        self.assertEqual(server.actions()[-1], "sync")

    def test_nothing_waiting_only_syncs(self):
        server = FakeServer()
        self.assertEqual(run_main(server), 0)
        self.assertEqual(server.actions(), ["work", "sync"])

    def test_a_server_error_reports_the_failure_and_moves_on(self):
        other = dict(CITY, id="bbbbbbbb-5a4d-4e6f-9a7b-1c2d3e4f5a6b", name="Dallas")
        server = FakeServer(cities=[CITY, other], fail_status=500)
        self.assertEqual(run_main(server), 0)
        fails = [c for c in server.calls if c[0] == "fail"]
        self.assertEqual(len(fails), 2)
        self.assertIn("500", fails[0][1]["detail"])
        self.assertEqual(server.actions()[-1], "sync")

    def test_missing_settings_stop_early(self):
        server = FakeServer()
        self.assertEqual(run_main(server, env={"CRAWLER_SECRET": ""}), 2)
        self.assertEqual(server.actions(), [])

    def test_preview_prints_places_and_records_nothing(self):
        server = FakeServer()
        with mock.patch.object(crawl_cities, "log") as log:
            self.assertEqual(run_main(server, ["--preview", "Austin", "--region", "TX"]), 0)
        self.assertEqual(server.actions(), ["preview"])
        self.assertEqual((server.calls[0][1]["name"], server.calls[0][1]["region"]), ("Austin", "TX"))
        printed = "\n".join(str(c.args[0]) for c in log.call_args_list)
        self.assertIn("Alpha Cafe", printed)
        self.assertIn("NO WEBSITE", printed)


if __name__ == "__main__":
    unittest.main()
