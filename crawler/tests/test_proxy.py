import asyncio
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
from egress_proxy import EgressProxy, default_allowed  # noqa: E402


class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"hello from the restaurant"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class DefaultRules(unittest.TestCase):
    def test_public_address_on_a_web_port_is_allowed(self):
        self.assertTrue(default_allowed("93.184.216.34", 443))
        self.assertTrue(default_allowed("93.184.216.34", 80))

    def test_internal_addresses_and_odd_ports_are_refused(self):
        for ip, port in (("127.0.0.1", 80), ("10.0.0.2", 443), ("169.254.169.254", 80), ("192.168.1.1", 443),
                         ("93.184.216.34", 22), ("93.184.216.34", 5432), ("::1", 443)):
            self.assertFalse(default_allowed(ip, port), (ip, port))


class ProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), Page)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_port

    async def client(self, proxy):
        port = await proxy.start()
        self.addAsyncCleanup(proxy.stop)
        c = httpx.AsyncClient(proxy=f"http://127.0.0.1:{port}", timeout=10)
        self.addAsyncCleanup(c.aclose)
        return c

    async def test_an_allowed_plain_http_page_comes_through(self):
        proxy = EgressProxy(allowed=lambda ip, port: port == self.port)
        c = await self.client(proxy)
        r = await c.get(f"http://127.0.0.1:{self.port}/menu?x=1")
        self.assertEqual((r.status_code, r.text), (200, "hello from the restaurant"))
        self.assertEqual(proxy.blocked, [])

    async def test_a_refused_address_gets_403_and_is_recorded(self):
        proxy = EgressProxy(allowed=lambda ip, port: False)
        c = await self.client(proxy)
        r = await c.get(f"http://127.0.0.1:{self.port}/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.headers.get("x-blocked-by"), "pikme-egress")
        self.assertEqual(proxy.blocked, ["127.0.0.1"])

    async def test_a_refused_https_tunnel_is_a_proxy_error(self):
        proxy = EgressProxy(allowed=lambda ip, port: False)
        c = await self.client(proxy)
        with self.assertRaises(httpx.ProxyError):
            await c.get("https://127.0.0.1/")

    async def test_the_name_is_resolved_by_the_proxy_and_one_bad_address_refuses_the_host(self):
        async def resolver(host, port):
            return ["127.0.0.1", "10.0.0.9"]            # a name that points at an internal machine
        proxy = EgressProxy(allowed=lambda ip, port: ip != "10.0.0.9", resolver=resolver)
        c = await self.client(proxy)
        r = await c.get(f"http://menu.example.com:{self.port}/")
        self.assertEqual(r.status_code, 403)

    async def test_unresolvable_names_are_refused(self):
        async def resolver(host, port):
            raise OSError("no such host")
        proxy = EgressProxy(resolver=resolver)
        c = await self.client(proxy)
        self.assertEqual((await c.get("http://nowhere.example.com/")).status_code, 403)

    async def test_it_connects_to_the_vetted_address_not_to_the_name(self):
        seen = []

        async def resolver(host, port):
            seen.append(host)
            return ["127.0.0.1"]                       # the name maps to the local test server
        proxy = EgressProxy(allowed=lambda ip, port: ip == "127.0.0.1", resolver=resolver)
        c = await self.client(proxy)
        r = await c.get(f"http://menu.example.com:{self.port}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(seen, ["menu.example.com"])

    async def test_non_http_requests_and_garbage_are_refused(self):
        proxy = EgressProxy(allowed=lambda ip, port: True)
        port = await proxy.start()
        self.addAsyncCleanup(proxy.stop)
        for raw in (b"GET ftp://example.com/ HTTP/1.1\r\n\r\n", b"NONSENSE\r\n\r\n", b"CONNECT nohost HTTP/1.1\r\n\r\n"):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(raw)
            await writer.drain()
            first = await asyncio.wait_for(reader.readline(), 5)
            writer.close()
            self.assertIn(b" 400 ", first, raw)


if __name__ == "__main__":
    unittest.main()
