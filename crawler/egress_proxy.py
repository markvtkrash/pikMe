"""A small local filtering proxy: the only way the worker's browser and HTTP client reach the internet.

Why it exists
-------------
The worker opens links typed in by restaurant owners and admins, on a machine that also runs the database. A page-level
check of the address is not enough: Chromium follows a redirect from a harmless address to http://127.0.0.1:... on its
own without asking again, and a hostile DNS server can answer differently the second time. This proxy closes both:
every connection the browser (or httpx) makes passes through here, the proxy resolves the host itself, refuses unless
EVERY address is a public internet address and the port is an ordinary web port, and then connects to the address it
just checked (not to the name). Redirects, subresources, WebSockets and service workers all go through the same door.

What it speaks
--------------
  CONNECT host:port   (https): checked, then an opaque tunnel.
  GET http://host/... (plain http, absolute-form): checked, rewritten to origin-form, sent with "Connection: close"
                      so one client connection never carries requests for two different hosts.
Anything else is refused.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from safety import ALLOWED_PORTS, ip_is_public

MAX_HEAD_BYTES = 64 * 1024
HEAD_TIMEOUT = 30
CONNECT_TIMEOUT = 15
IDLE_TIMEOUT = 120
MAX_CONNECTIONS = 200
PIPE_CHUNK = 64 * 1024


def default_allowed(ip: str, port: int) -> bool:
    return ip_is_public(ip) and port in ALLOWED_PORTS


async def _resolve(host: str, port: int):
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    seen, out = set(), []
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out


def _refuse(status: int, reason: str) -> bytes:
    return (f"HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n"
            f"X-Blocked-By: pikme-egress\r\n\r\n").encode("ascii")


class EgressProxy:
    def __init__(self, allowed=default_allowed, resolver=_resolve):
        self._allowed = allowed          # (ip, port) -> bool
        self._resolve = resolver         # (host, port) -> [ip, ...]
        self._server = None
        self._sem = asyncio.Semaphore(MAX_CONNECTIONS)
        self.blocked = []                # hosts refused, for logging and tests

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        self._server = await asyncio.start_server(self._handle, host, port)
        return self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    # ── choosing where to connect ───────────────────────────────────────────
    async def _vetted_addresses(self, host: str, port: int):
        """The addresses to connect to, or None if the host must be refused (any bad address refuses it)."""
        host = host.strip("[]")
        try:
            ipaddress.ip_address(host)
            addresses = [host]
        except ValueError:
            try:
                addresses = await self._resolve(host, port)
            except Exception:
                return None
        if not addresses or not all(self._allowed(a, port) for a in addresses):
            return None
        return addresses

    async def _open(self, addresses, port):
        last = None
        for ip in addresses:
            try:
                return await asyncio.wait_for(asyncio.open_connection(ip, port), CONNECT_TIMEOUT)
            except Exception as e:
                last = e
        raise last or OSError("no address to connect to")

    # ── one client connection ───────────────────────────────────────────────
    async def _handle(self, reader, writer):
        async with self._sem:
            try:
                await self._serve(reader, writer)
            except (Exception, asyncio.CancelledError):    # a dropped connection or shutdown is not an error here
                pass
            finally:
                try:
                    writer.close()
                except Exception:
                    pass

    async def _serve(self, reader, writer):
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), HEAD_TIMEOUT)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
            return
        if len(head) > MAX_HEAD_BYTES:
            writer.write(_refuse(431, "Request Header Fields Too Large"))
            return

        lines = head.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) != 3:
            writer.write(_refuse(400, "Bad Request"))
            return
        method, target, version = parts

        if method.upper() == "CONNECT":
            host, _, port_text = target.rpartition(":")
            if not host or not port_text.isdigit():
                writer.write(_refuse(400, "Bad Request"))
                return
            port = int(port_text)
            addresses = await self._vetted_addresses(host, port)
            if addresses is None:
                self.blocked.append(host)
                writer.write(_refuse(403, "Forbidden"))
                return
            try:
                up_reader, up_writer = await self._open(addresses, port)
            except Exception:
                writer.write(_refuse(502, "Bad Gateway"))
                return
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            await self._pipe_both(reader, writer, up_reader, up_writer)
            return

        # plain http in absolute form
        url = urlsplit(target)
        if url.scheme != "http" or not url.hostname:
            writer.write(_refuse(400, "Bad Request"))
            return
        try:
            port = url.port or 80
        except ValueError:
            writer.write(_refuse(400, "Bad Request"))
            return
        addresses = await self._vetted_addresses(url.hostname, port)
        if addresses is None:
            self.blocked.append(url.hostname)
            writer.write(_refuse(403, "Forbidden"))
            return
        try:
            up_reader, up_writer = await self._open(addresses, port)
        except Exception:
            writer.write(_refuse(502, "Bad Gateway"))
            return

        path = url.path or "/"
        if url.query:
            path += "?" + url.query
        kept = [ln for ln in lines[1:] if ln and ln.split(":", 1)[0].strip().lower()
                not in ("proxy-connection", "proxy-authorization", "connection", "keep-alive")]
        request = "\r\n".join([f"{method} {path} {version}"] + kept + ["Connection: close", "", ""])
        up_writer.write(request.encode("latin-1"))
        await up_writer.drain()
        await self._pipe_both(reader, writer, up_reader, up_writer)

    # ── copying bytes ───────────────────────────────────────────────────────
    async def _pipe_both(self, a_reader, a_writer, b_reader, b_writer):
        async def pipe(src, dst):
            try:
                while True:
                    data = await asyncio.wait_for(src.read(PIPE_CHUNK), IDLE_TIMEOUT)
                    if not data:
                        break
                    dst.write(data)
                    await dst.drain()
            except (Exception, asyncio.CancelledError):
                pass
            finally:
                try:
                    dst.close()
                except Exception:
                    pass

        await asyncio.gather(pipe(a_reader, b_writer), pipe(b_reader, a_writer))
