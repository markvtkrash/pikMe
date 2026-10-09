import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from safety import UrlGuard, check_url_syntax, ip_is_public  # noqa: E402


class IpIsPublic(unittest.TestCase):
    def test_public_addresses_pass(self):
        for ip in ("8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"):
            self.assertTrue(ip_is_public(ip), ip)

    def test_private_internal_and_special_addresses_are_refused(self):
        for ip in (
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1",
            "::ffff:127.0.0.1", "::ffff:10.1.2.3", "2002:7f00:1::1",
        ):
            self.assertFalse(ip_is_public(ip), ip)

    def test_not_an_address_is_refused(self):
        for ip in ("", "localhost", "example.com", "999.1.1.1"):
            self.assertFalse(ip_is_public(ip), ip)


class CheckUrlSyntax(unittest.TestCase):
    def test_ordinary_web_addresses_pass(self):
        for url in ("https://example.com/menu", "http://example.com", "https://example.com:8443/x?y=1"):
            self.assertIsNone(check_url_syntax(url), url)

    def test_other_schemes_are_refused(self):
        for url in ("ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "gopher://x"):
            self.assertIsNotNone(check_url_syntax(url), url)

    def test_credentials_odd_ports_and_junk_are_refused(self):
        for url in ("https://user:pw@example.com/", "https://user@example.com/", "http://example.com:22/",
                    "http://example.com:5432/", "https://", "", None, "x" * 2500, "http://example.com:99999/"):
            self.assertIsNotNone(check_url_syntax(url), repr(url)[:40])


class FakeResolver:
    def __init__(self, table):
        self.table, self.calls = table, 0

    async def __call__(self, host):
        self.calls += 1
        if host not in self.table:
            raise OSError("no such host")
        return self.table[host]


class GuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_public_host_is_allowed(self):
        guard = UrlGuard(FakeResolver({"menu.example.com": ["93.184.216.34"]}))
        self.assertEqual(await guard.check("https://menu.example.com/x"), (True, "", True))
        self.assertTrue(await guard.allows("https://menu.example.com/y"))

    async def test_a_host_that_resolves_to_a_private_address_is_refused_for_good(self):
        guard = UrlGuard(FakeResolver({"evil.example.com": ["10.0.0.7"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"]}))
        ok, reason, permanent = await guard.check("https://evil.example.com/")
        self.assertFalse(ok)
        self.assertTrue(permanent)
        self.assertIn("private", reason)
        self.assertFalse(await guard.allows("https://mixed.example.com/"))   # ONE bad address is enough

    async def test_ip_addresses_in_the_link_are_checked_without_a_lookup(self):
        resolver = FakeResolver({})
        guard = UrlGuard(resolver)
        self.assertFalse(await guard.allows("http://127.0.0.1:8080/"))
        self.assertFalse(await guard.allows("http://169.254.169.254/latest/meta-data/"))
        self.assertFalse(await guard.allows("http://[::1]/"))
        self.assertTrue(await guard.allows("http://8.8.8.8/"))
        self.assertEqual(resolver.calls, 0)

    async def test_localhost_by_name_is_refused(self):
        guard = UrlGuard(FakeResolver({"localhost": ["127.0.0.1", "::1"]}))
        self.assertFalse(await guard.allows("http://localhost:3000/"))

    async def test_a_failed_lookup_is_not_permanent(self):
        guard = UrlGuard(FakeResolver({}))
        ok, reason, permanent = await guard.check("https://nowhere.example.com/")
        self.assertFalse(ok)
        self.assertFalse(permanent)
        self.assertIn("could not look up", reason)

    async def test_bad_syntax_is_permanent_and_never_looked_up(self):
        resolver = FakeResolver({"example.com": ["93.184.216.34"]})
        guard = UrlGuard(resolver)
        ok, reason, permanent = await guard.check("file:///etc/passwd")
        self.assertEqual((ok, permanent), (False, True))
        self.assertEqual(resolver.calls, 0)

    async def test_answers_are_remembered_for_a_few_minutes_then_looked_up_again(self):
        now = [1000.0]
        resolver = FakeResolver({"menu.example.com": ["93.184.216.34"]})
        guard = UrlGuard(resolver, clock=lambda: now[0])
        await guard.allows("https://menu.example.com/a")
        await guard.allows("https://menu.example.com/b")
        self.assertEqual(resolver.calls, 1)
        now[0] += 301
        await guard.allows("https://menu.example.com/c")
        self.assertEqual(resolver.calls, 2)


if __name__ == "__main__":
    unittest.main()
