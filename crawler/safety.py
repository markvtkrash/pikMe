"""Address safety for the menu crawl worker.

The worker opens links that restaurant owners and admins typed in, from a machine that also runs the database.
Without a check, a link such as http://localhost:54321/... or http://169.254.169.254/... would let the browser
reach services on the VPS. Every request the browser or the plain-HTTP fallback makes (including each redirect hop)
must pass UrlGuard.allows(): http/https only, no credentials in the address, a normal web port, and a host that
resolves ONLY to public internet addresses.

Limit: the check resolves the name before the browser does. A hostile DNS server could answer differently the second
time ("DNS rebinding"). Running the VPS firewall so that Chromium's user cannot reach the Supabase ports adds a
second layer; see README.md.
"""

import asyncio
import ipaddress
import socket
import time
from urllib.parse import urlparse

ALLOWED_PORTS = {None, 80, 443, 8080, 8443}
MAX_URL_LENGTH = 2000
CACHE_SECONDS = 300


def ip_is_public(ip: str) -> bool:
    """True only for an ordinary public internet address."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:          # ::ffff:127.0.0.1 is really 127.0.0.1
            addr = addr.ipv4_mapped
        elif addr.sixtofour is not None or addr.teredo is not None:
            return False                           # tunnels that can hide an internal IPv4 address
    return bool(addr.is_global) and not addr.is_multicast


def check_url_syntax(url: str):
    """Returns None if the address is acceptable to open, else a short reason."""
    if not isinstance(url, str) or not url or len(url) > MAX_URL_LENGTH:
        return "not a usable address"
    try:
        p = urlparse(url)
        port = p.port
    except ValueError:
        return "not a valid address"
    if p.scheme not in ("http", "https"):
        return "only http and https links are allowed"
    if not p.hostname:
        return "no host in the address"
    if p.username or p.password:
        return "addresses with a user name or password are not allowed"
    if port not in ALLOWED_PORTS:
        return f"port {port} is not allowed"
    return None


async def _default_resolver(host: str):
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


class UrlGuard:
    """Decides whether the worker may open an address. Results per host are remembered for a few minutes."""

    def __init__(self, resolver=None, clock=time.monotonic):
        self._resolve = resolver or _default_resolver
        self._clock = clock
        self._cache = {}

    async def check(self, url: str):
        """Returns (allowed, reason, permanent). permanent=False means a lookup failed and trying again later may work."""
        bad = check_url_syntax(url)
        if bad:
            return False, bad, True
        host = urlparse(url).hostname.strip("[]").lower()

        now = self._clock()
        hit = self._cache.get(host)
        if hit and hit[0] > now:
            return hit[1]

        try:
            ipaddress.ip_address(host)
            addresses = [host]
        except ValueError:
            try:
                addresses = await self._resolve(host)
            except Exception as e:                 # DNS trouble is not the owner's fault: a later try may work
                return False, f"could not look up {host} ({type(e).__name__})", False

        if not addresses:
            verdict = (False, f"{host} has no address", False)
        elif all(ip_is_public(a) for a in addresses):
            verdict = (True, "", True)
        else:
            verdict = (False, f"{host} points to a private or internal address", True)

        self._cache[host] = (now + CACHE_SECONDS, verdict)
        return verdict

    async def allows(self, url: str) -> bool:
        allowed, _reason, _permanent = await self.check(url)
        return allowed
