import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crawl_agent  # noqa: E402


class FakeGuard:
    def __init__(self, allowed=True):
        self.allowed = allowed

    async def check(self, url):
        return (self.allowed, "" if self.allowed else "private address", not self.allowed)

    async def allows(self, url):
        return self.allowed


class FakeSession:
    def __init__(self):
        self.started = 0

    async def ready(self):
        self.started += 1
        return object(), object()


class FakeApi:
    """Answers each step with the next prepared reply and records what the worker reported."""

    def __init__(self, replies):
        self.replies, self.seen = list(replies), []

    async def step(self, job_id, url, result, items):
        self.seen.append((job_id, url, result, items))
        return self.replies.pop(0)


def run(coro):
    return asyncio.run(coro)


class CarryOut(unittest.TestCase):
    def test_an_unknown_instruction_is_refused_and_nothing_is_opened(self):
        session = FakeSession()
        for bad in ({"do": "run_shell", "url": "https://a.com"}, {"do": "open_page"}, {"do": "done"}, {}):
            r = run(crawl_agent.carry_out(session, FakeGuard(), bad, 5))
            self.assertFalse(r["ok"])
            self.assertEqual(r["reason"], "instruction refused")
        self.assertEqual(session.started, 0)

    def test_read_image_is_reported_as_unsupported(self):
        r = run(crawl_agent.carry_out(FakeSession(), FakeGuard(), {"do": "read_image", "url": "https://a.com/m.jpg"}, 5))
        self.assertFalse(r["ok"])
        self.assertIn("not supported", r["reason"])


class Checked(unittest.TestCase):
    def test_a_blocked_address_is_reported_with_its_reason(self):
        why = run(crawl_agent.checked(FakeGuard(False), object(), "http://10.0.0.1/"))
        self.assertTrue(why.startswith("blocked"))

    def test_a_page_blocked_by_the_guard_is_never_opened(self):
        r = run(crawl_agent.open_page(object(), object(), FakeGuard(False), "http://10.0.0.1/", 5))
        self.assertEqual((r["ok"], r["links"], r["text"]), (False, [], ""))

    def test_robots_refusal_is_reported(self):
        original = crawl_agent.menu_reader.allowed

        async def deny(http, url):
            return False
        crawl_agent.menu_reader.allowed = deny
        self.addCleanup(lambda: setattr(crawl_agent.menu_reader, "allowed", original))
        self.assertEqual(run(crawl_agent.checked(FakeGuard(), object(), "https://a.com/menu")), "robots")


class RunJob(unittest.TestCase):
    def args(self, ceiling=50):
        return SimpleNamespace(hard_max_steps=ceiling, page_timeout=5, verbose=False)

    def test_follows_instructions_until_done_and_carries_the_dishes_back(self):
        api = FakeApi([
            {"next": {"do": "open_page", "url": "https://a.com/menu"}, "items": [{"name": "Burger"}]},
            {"next": {"do": "done"}, "items": [{"name": "Burger"}, {"name": "Fries"}]},
        ])
        opened = []

        async def fake_carry(session, guard, step, timeout):
            opened.append(step["url"])
            return crawl_agent.fail("test")
        original = crawl_agent.carry_out
        crawl_agent.carry_out = fake_carry
        self.addCleanup(lambda: setattr(crawl_agent, "carry_out", original))

        out = run(crawl_agent.run_job(api, FakeSession(), FakeGuard(), {"id": 7}, {"do": "open_page", "url": "https://a.com"}, self.args()))
        self.assertEqual(opened, ["https://a.com", "https://a.com/menu"])
        self.assertEqual(api.seen[1][3], [{"name": "Burger"}])       # the dishes found so far travel back with the next step
        self.assertIn("2 dishes", out)

    def test_the_local_ceiling_stops_a_server_that_never_says_done(self):
        api = FakeApi([{"next": {"do": "open_page", "url": "https://a.com/x"}, "items": []}] * 10)

        async def fake_carry(session, guard, step, timeout):
            return crawl_agent.fail("test")
        original = crawl_agent.carry_out
        crawl_agent.carry_out = fake_carry
        self.addCleanup(lambda: setattr(crawl_agent, "carry_out", original))

        out = run(crawl_agent.run_job(api, FakeSession(), FakeGuard(), {"id": 1}, {"do": "open_page", "url": "https://a.com"}, self.args(3)))
        self.assertIn("ceiling", out)
        self.assertEqual(len(api.seen), 3)

    def test_a_reply_without_an_instruction_ends_the_job(self):
        api = FakeApi([{}])

        async def fake_carry(session, guard, step, timeout):
            return crawl_agent.fail("test")
        original = crawl_agent.carry_out
        crawl_agent.carry_out = fake_carry
        self.addCleanup(lambda: setattr(crawl_agent, "carry_out", original))

        out = run(crawl_agent.run_job(api, FakeSession(), FakeGuard(), {"id": 1}, {"do": "open_page", "url": "https://a.com"}, self.args()))
        self.assertIn("finished after 1", out)


class Headers(unittest.TestCase):
    def test_carries_only_the_crawler_secret_and_optionally_the_anon_key(self):
        h = crawl_agent.AgentApi("https://x/menu-agent", "s3cret").headers()
        self.assertEqual(h["x-crawler-secret"], "s3cret")
        self.assertNotIn("Authorization", h)
        h2 = crawl_agent.AgentApi("https://x/menu-agent", "s3cret", "anon").headers()
        self.assertEqual(h2["Authorization"], "Bearer anon")


if __name__ == "__main__":
    unittest.main()
