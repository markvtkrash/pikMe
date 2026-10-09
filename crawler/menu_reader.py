"""
crawl_menus.py - find and capture the real menu for each restaurant chain.

How it reads a page
-------------------
No HTML parsing. The page is rendered in a real browser and the menu is found
by how it LOOKS on screen, using the browser's own rendered text (innerText):

  * A menu is a run of similar, repeated "cards" side by side - same element
    type and styling - each with a short name plus calories, a price, a
    description or a photo.
  * The detector scans the rendered page for groups of 3+ look-alike sibling
    elements, scores how menu-like each group is, and ignores navigation,
    headers/footers, cookie banners and pop-ups.
  * Each card becomes one line ("- Classic Burger | 550 Cal | Beef, lettuce"),
    grouped under the nearest heading above it (the category).
  * If no such group exists, the page is judged "not a menu" and the crawler
    keeps exploring instead of saving it.

How it finds the menu on a site
-------------------------------
  1. Menu loaded by JavaScript from an API -> every JSON response the browser
     receives is captured and checked for menu-like lists of items.
  2. Menu data built into the page (Next.js, Nuxt...) -> read straight from
     the page's data blocks the same way.
  3. /menu only shows categories -> best-first recursive crawl: every link is
     scored (menu, nutrition, burgers, /menu/... sub-pages) and the most
     promising pages are visited first, within a page budget and depth limit.
  4. Sitemap -> robots.txt + sitemap.xml menu-looking URLs seed the crawl.
  5. Items behind clicks -> cookie banners dismissed, page scrolled, "Load
     more" pressed, accordions opened, and every tab clicked and re-read.
  6. "Choose a store first" -> with --zip, types the ZIP and picks a store.
  7. Nutrition / menu PDFs -> downloaded.
  8. Site blocks the automated browser (HTTP 403, dropped connections, bot-check
     pages) -> the page is fetched with a plain, openly identified request
     instead, and the same menu detector reads it in an offline browser tab
     (no network, nothing executed against the site). The crawler stays in that
     mode for the rest of that restaurant. If plain requests are refused too,
     it stops early and says so in the manifest.

Output per restaurant (pages/<restaurant>/):
  page_01.txt ...      menu text from pages detected as menus (best first)
  api_01.json ...      menu-like data captured from the site's API calls
  embedded_01.json ... menu-like data built into page code
  pdf_01.pdf ...       nutrition / menu PDFs
  items_index.txt      unique item names from the JSON data
  manifest.json        every page visited, its result, and what was saved
Plus crawl_report.csv: one row per restaurant, status good / weak / empty.

Input: chains.csv with columns restaurant_name, website, menu_url

Setup:
  pip install playwright httpx
  playwright install chromium

Run:
  python crawl_menus.py --limit 5                    # test on first 5
  python crawl_menus.py                              # everything
  python crawl_menus.py --only "Taco Bell" --headed  # watch the browser work
  python crawl_menus.py --zip 60601                  # get past "choose a store"
  python crawl_menus.py --retry-weak                 # redo weak/empty ones
"""

import argparse
import asyncio
import csv
import gzip
import heapq
import html as htmllib
import json
import re
import sys
import traceback
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from playwright.async_api import async_playwright

# ======================= settings =======================
OUTPUT_DIR = Path("pages")
# Optional async callable url -> bool. When set, every browser request must pass it (see crawl_places.py).
URL_GUARD = None
# Menu PDFs are downloaded by default (the original script); crawl_places.py turns this off because it only uses
# the text and JSON files, so a PDF would just fill the disk.
SAVE_PDFS = True
REPORT_CSV = Path("crawl_report.csv")
MAX_PAGES = 25                 # pages visited per restaurant
MAX_DEPTH = 3                  # link hops from the start pages
MAX_SITEMAP_FILES = 15
MAX_SITEMAP_SEEDS = 40
MAX_PDFS = 3
MAX_JSON_BYTES = 8_000_000
MAX_PDF_BYTES = 30_000_000
PAGE_DELAY = 1.5               # seconds between pages on one site
PAGE_TIMEOUT = 120             # hard limit for one page, seconds
RESTAURANT_TIMEOUT = 20 * 60   # hard limit for one restaurant, seconds
BOT_NAME = "MenuCollectorBot"
PLAIN_HEADERS = {   # used for robots.txt, sitemaps, PDFs and blocked-browser fallback
    "User-Agent": f"{BOT_NAME}/2.0 (restaurant menu research)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 " + BOT_NAME + "/2.0")

# ======================= link scoring =======================
SKIP_RE = re.compile(
    r"career|\bjobs?\b|franchis|gift|privacy|terms|legal|press|newsroom|/news|blog|"
    r"investor|about-us|/about|contact|log-?in|sign-?in|sign-?up|register|/account|"
    r"rewards|loyalty|download|apps\.apple|play\.google|store-locator|/locations?\b|"
    r"/locator|find-a|/faq|/help|support|foundation|donat|accessib|cookie|/cart|"
    r"checkout|merch|/es/|/es-|/fr/|/fr-|espanol|mailto:|tel:|javascript:|"
    r"facebook|instagram|twitter|tiktok|youtube|linkedin|pinterest", re.I)
STRONG_RE = re.compile(r"menu|nutrition|allergen", re.I)
FOOD_RE = re.compile(
    r"food|drink|beverage|product|item|categor|meal|breakfast|lunch|dinner|dessert|"
    r"\bsides?\b|sandwich|burger|pizza|chicken|taco|burrito|salad|coffee|wings?\b|"
    r"\bsubs?\b|bowls?\b|kids|combo|shake|smoothie|donut|bagel|pasta|steak|seafood|"
    r"appetizer|entree|starter|fries|tender|nugget|wrap|soup|cookie|tea\b|latte", re.I)
ASSET_RE = re.compile(r"\.(jpe?g|png|gif|webp|svg|css|js|ico|mp4|webm|zip|xml|json|woff2?)(\?|$)", re.I)
GATE_RE = re.compile(
    r"(select|choose|find|set|pick)\s+(a|your)\s+(location|restaurant|store)|"
    r"enter (a |your )?(zip|address|city)|to (see|view) (the |our )?(full )?menu", re.I)
CAL_RE = re.compile(r"\b\d{1,4}(?:\s*[-–/]\s*\d{1,4})?\s*(?:cal|cals|calories|kcal)\b", re.I)

# signs that a site is refusing the automated browser
BLOCK_STATUS = {401, 403, 405, 429, 503}
BLOCK_ERR_RE = re.compile(r"ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|"
                          r"ERR_EMPTY_RESPONSE|ERR_QUIC_PROTOCOL_ERROR|ERR_SSL_PROTOCOL_ERROR|"
                          r"ERR_BLOCKED_BY_RESPONSE")
BLOCK_TITLE_RE = re.compile(r"access denied|attention required|just a moment|are you a (human|robot)|"
                            r"captcha|request blocked|pardon our interruption|bot detection", re.I)
LINKS_JS = ("els => els.map(e => [e.href, (e.innerText || e.textContent || "
            "e.getAttribute('aria-label') || '').trim().slice(0, 100)])")
# locale folders like /en-ca/, /fr-ca/, /es-pr/ (anything except US English)
LOCALE_RE = re.compile(r"/([a-z]{2})[-_]([a-z]{2})(?=/|\.|$)", re.I)


def foreign_locale(url: str) -> bool:
    m = LOCALE_RE.search(urlparse(url).path)
    return bool(m) and (m.group(1).lower(), m.group(2).lower()) not in (("en", "us"), ("us", "en"))


class SiteBlocked(Exception):
    pass


async def limited(aw, seconds):
    """Await something, but give up after `seconds` (raises asyncio.TimeoutError)."""
    return await asyncio.wait_for(aw, timeout=seconds)


def err_text(e: Exception, limit: int = 200) -> str:
    """First line of an error message; falls back to the error type (e.g. a timeout with no message)."""
    lines = [ln for ln in str(e).splitlines() if ln.strip()]
    first = lines[0].strip() if lines else ""
    return (f"{type(e).__name__}: {first}" if first else type(e).__name__)[:limit]


def link_score(href: str, text: str, menu_path: str) -> int:
    if ASSET_RE.search(href) or SKIP_RE.search(href + " " + text) or foreign_locale(href):
        return 0
    path = urlparse(href).path.lower()
    score = 0
    if STRONG_RE.search(path):
        score += 6
    if STRONG_RE.search(text):
        score += 4
    score += 2 * min(len(FOOD_RE.findall(path)), 2) + min(len(FOOD_RE.findall(text)), 2)
    if menu_path not in ("", "/") and path.startswith(menu_path.rstrip("/") + "/"):
        score += 5             # child of the menu page: category or item page
    return score


# ======================= in-browser menu detection =======================
# Runs inside the page. Finds groups of look-alike sibling "cards", decides
# which are menu items, and returns their rendered text.
MENU_JS = r"""
() => {
  const CAL = /\b\d{1,4}(?:\s*[-–\/]\s*\d{1,4})?\s*(?:cal|cals|calories|kcal)\b/i;
  const PRICE = /\$\s?\d{1,3}(?:\.\d{2})?/;
  const CATEGORY = /\b(burgers?|chicken|sides|drinks|beverages|desserts|sweets|treats|breakfast|lunch|dinner|salads|sandwiches|wraps|kids|meals|combos|value|snacks|coffee|teas?|shakes|smoothies|pizzas?|pastas?|appetizers|entrees|starters|soups|bowls|tacos|burritos|wings|subs|fries|featured|deals|specials|seafood|steaks|bakery|bagels|donuts|extras|sauces|favorites|classics|limited time|bundles|family|catering|frozen|ice cream|cafe|mccafe|sweet treats|happy meal|new)\b/i;
  const JUNK = new Set(["order now","start order","start your order","order online","order",
    "add to bag","add to cart","add to order","add","customize","learn more","view details",
    "see details","details","view menu","find a location","change location","select location",
    "find a restaurant","sign in","log in","join now","download the app","get the app",
    "back to top","close","open","next","previous","view all","see all","new","loading...",
    "skip to main content","skip to content","select","choose","buy now","quick add",
    "nutrition","nutrition info","see nutrition","+","-"]);
  const NOISE = /cookie|consent|onetrust|gdpr|newsletter|subscribe|modal|popup|toast|breadcrumb|site-header|site-footer|global-header|global-footer|navbar|navigation|mega-?menu|skip-/i;
  const BAD_TAGS = new Set(["SCRIPT","STYLE","NOSCRIPT","SVG","NAV","IFRAME","TEMPLATE","DIALOG","HEAD"]);
  const BAD_ROLES = new Set(["navigation","banner","contentinfo","dialog","alertdialog","menu","menubar"]);

  const isNoise = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (BAD_TAGS.has(e.tagName)) return true;
      if ((e.tagName === "HEADER" || e.tagName === "FOOTER") && !e.closest("main,article,section,li")) return true;
      if (BAD_ROLES.has(e.getAttribute("role"))) return true;
      const c = typeof e.className === "string" ? e.className : (e.getAttribute("class") || "");
      if (NOISE.test((e.id || "") + " " + c)) return true;
    }
    return false;
  };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity || "1") > 0;
  };
  const cls = (el) => {
    const c = typeof el.className === "string" ? el.className : (el.getAttribute("class") || "");
    return c.split(/\s+/).filter(x => x && !/(active|selected|current|odd|even|first|last|hidden|visible|^is-|^has-|--|\d{2,})/i.test(x)).sort().join(".");
  };
  const sig = (el) => el.tagName + "|" + cls(el);
  const lines = (el) => (el.innerText || "").split("\n")
      .map(s => s.replace(/\s+/g, " ").trim())
      .filter(s => s && /[A-Za-z0-9]/.test(s) && !JUNK.has(s.toLowerCase()));

  const cardInfo = (el, extra) => {
    let ls = lines(el);
    let img = !!el.querySelector("img,picture,[style*='background-image']");
    for (const x of (extra || [])) { ls = ls.concat(lines(x)); img = img || !!(x.querySelector && x.querySelector("img")); }
    if (!ls.length) return null;
    // collapse repeated lines inside a card
    ls = ls.filter((s, i) => ls.indexOf(s) === i);
    const text = ls.join(" | ");
    if (text.length > 700) return null;
    const title = ls[0];
    return {
      el, text, title,
      hasTitle: title.length >= 2 && title.length <= 80 && /[A-Za-z]/.test(title) && !CAL.test(title),
      cal: CAL.test(text),
      price: PRICE.test(text),
      desc: ls.slice(1).some(s => s.length >= 25 && !CAL.test(s)),
      img,
    };
  };

  // 1. find groups of look-alike siblings
  const groups = [];
  for (const p of document.body.querySelectorAll("*")) {
    if (p.children.length < 3 || BAD_TAGS.has(p.tagName)) continue;
    const bySig = new Map();
    for (const k of p.children) {
      const s = sig(k);
      if (!bySig.has(s)) bySig.set(s, []);
      bySig.get(s).push(k);
    }
    for (const [s, members] of bySig) {
      if (members.length < 3) continue;
      const headRun = /^H[2-6]$/.test(members[0].tagName);   // <h3>name</h3><p>details</p> pattern
      const cards = [];
      for (const m of members) {
        if (!visible(m)) continue;
        let extra = null;
        if (headRun) {
          extra = [];
          for (let n = m.nextElementSibling; n && sig(n) !== s && extra.length < 4; n = n.nextElementSibling) extra.push(n);
        }
        const ci = cardInfo(m, extra);
        if (ci) cards.push(ci);
      }
      if (cards.length < 3) continue;
      const n = cards.length, frac = (k) => cards.filter(c => c[k]).length / n;
      const distinct = new Set(cards.map(c => c.title.toLowerCase())).size / n;
      if (frac("hasTitle") < 0.6 || distinct < 0.7) continue;
      const strong = frac("cal") >= 0.3 || frac("price") >= 0.5 || (frac("desc") >= 0.5 && n >= 5);
      const weak = frac("img") >= 0.6 && n >= 5;
      if (!strong && !weak) continue;
      if (isNoise(p)) continue;
      // tiles named "Burgers", "Chicken", "Drinks"... are categories, not items
      const catLike = cards.filter(c => c.title.split(" ").length <= 3 && CATEGORY.test(c.title)).length / n;
      const isCategories = !strong && catLike >= 0.6;
      const score = cards.reduce((a, c) => a + 1 + (c.cal ? 2 : 0) + (c.price ? 1 : 0) + (c.desc ? 0.5 : 0) + (c.img ? 0.3 : 0), 0) * (strong ? 1 : isCategories ? 0.2 : 0.6);
      groups.push({ parent: p, cards, score, strong, isCategories });
    }
  }

  // 2. keep the best groups, dropping ones nested inside another group's cards
  groups.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const g of groups) {
    const nested = kept.some(k => k.cards.some(c => c.el.contains(g.parent)) || g.cards.some(c => c.el.contains(k.parent)));
    if (!nested) kept.push(g);
  }
  kept.sort((a, b) => (a.parent.compareDocumentPosition(b.parent) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

  // 3. category = nearest visible heading above each group
  const heads = [...document.querySelectorAll("h1,h2,h3,h4,[role='heading']")].filter(h => visible(h) && !isNoise(h));
  const headingFor = (g) => {
    let best = null;
    for (const h of heads) {
      if (g.cards.some(c => c.el.contains(h) || c.el === h)) continue;
      if (g.parent.contains(h)) {
        if (h.compareDocumentPosition(g.cards[0].el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
        continue;
      }
      if (h.compareDocumentPosition(g.parent) & Node.DOCUMENT_POSITION_FOLLOWING) best = h; else break;
    }
    return best ? best.innerText.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  };

  // 4. clean text for each card: rendered text pieces in reading order,
  //    leaving out buttons ("Add to Bag") and keeping separate blocks apart
  const SKIP_ANC = "button,[role='button'],select,svg,script,style,noscript,[aria-hidden='true']";
  const blockOf = (node, root) => {
    for (let e = node.parentElement; e && e !== root; e = e.parentElement) {
      const d = getComputedStyle(e).display;
      if (d !== "inline" && d !== "contents") return e;
    }
    return root;
  };
  const segments = (root) => {
    const segs = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let lastBlock = null, node;
    while ((node = w.nextNode())) {
      const t = node.nodeValue.replace(/\s+/g, " ").trim();
      const par = node.parentElement;
      if (!t || !par) continue;
      const anc = par.closest(SKIP_ANC);
      if ((anc && anc !== root && root.contains(anc)) || !par.getClientRects().length ||
          getComputedStyle(par).visibility === "hidden") { lastBlock = null; continue; }
      const b = blockOf(node, root);
      if (b === lastBlock && segs.length) segs[segs.length - 1] += " " + t;
      else { segs.push(t); lastBlock = b; }
    }
    return segs;
  };
  const cleanText = (c, headRunExtra) => {
    let segs = segments(c.el);
    for (const x of (headRunExtra || [])) segs = segs.concat(segments(x));
    segs = segs.map(s => s.trim()).filter(s => s && /[A-Za-z0-9]/.test(s) && !JUNK.has(s.toLowerCase()));
    segs = segs.filter((s, i) => segs.indexOf(s) === i);
    return segs.join(" | ").slice(0, 500);
  };

  // 5. output
  const out = [], seen = new Set();
  let items = 0, calItems = 0, priceItems = 0, last = null;
  for (const g of kept) {
    const h = headingFor(g);
    if (g.isCategories) {
      out.push("");
      out.push("Categories: " + g.cards.map(c => c.title).join(", "));
      continue;
    }
    if (h && h !== last) { if (out.length) out.push(""); out.push("## " + h); last = h; }
    for (const c of g.cards) {
      let extra = null;
      if (/^H[2-6]$/.test(c.el.tagName)) {
        extra = [];
        const s = sig(c.el);
        for (let n = c.el.nextElementSibling; n && sig(n) !== s && extra.length < 4; n = n.nextElementSibling) extra.push(n);
      }
      const text = cleanText(c, extra) || c.text;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push("- " + text);
      items++; if (c.cal) calItems++; if (c.price) priceItems++;
    }
  }
  const main = document.querySelector("main,[role='main']") || document.body;
  return {
    isMenu: items >= 5 || calItems >= 3,
    items, calItems, priceItems, groups: kept.length,
    menuText: out.join("\n").trim(),
    pageText: (main.innerText || "").slice(0, 20000),
    title: document.title,
  };
}
"""

# Menu data that sites build into the page for their JavaScript to use.
EMBED_JS = r"""
() => {
  const out = [], MAX = 8000000;
  for (const s of document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"],script#__NEXT_DATA__')) {
    const t = s.textContent; if (t && t.length < MAX) out.push(t);
  }
  for (const k of ["__NUXT__","__INITIAL_STATE__","__APOLLO_STATE__","__PRELOADED_STATE__","__remixContext","__STATE__"]) {
    try { const v = window[k]; if (v && typeof v === "object") { const t = JSON.stringify(v); if (t.length < MAX) out.push(t); } } catch (e) {}
  }
  return out;
}
"""


def merge_texts(chunks: list[str]) -> str:
    """Combine snapshots (e.g. one per tab) without repeating lines."""
    seen, out = set(), []
    for ch in chunks:
        for ln in ch.splitlines():
            key = ln.strip()
            if not key:
                if out and out[-1] != "":
                    out.append("")
                continue
            if key in seen:
                continue
            seen.add(key)
            if (key.startswith("## ") or key.startswith("Categories:")) and out and out[-1] != "":
                out.append("")
            out.append(ln)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n" if out else ""


def menu_score(text: str) -> float:
    items = [ln for ln in text.splitlines() if ln.startswith("- ")]
    cal = sum(1 for ln in items if CAL_RE.search(ln))
    return float(len(items) + 2 * cal)


# ======================= JSON menu detection =======================
NAME_KEYS = ("name", "title", "displayName", "display_name", "productName", "product_name",
             "itemName", "item_name", "menuItemName", "shortName", "short_name", "label")
STRONG_KEY_RE = re.compile(r"calor|nutrition|price|ingredient|allergen|serving|description|desc$", re.I)
KEEP_KEY_RE = re.compile(r"calor|desc|categor|size|serving|allergen|ingredient|type|group|section|"
                         r"sku|id$|slug", re.I)


def item_name(d: dict) -> str | None:
    for k in NAME_KEYS:
        v = d.get(k)
        if isinstance(v, str) and 1 < len(v.strip()) < 120:
            return v.strip()
        if isinstance(v, dict):                       # e.g. {"name": {"en": "..."}}
            for vv in v.values():
                if isinstance(vv, str) and 1 < len(vv.strip()) < 120:
                    return vv.strip()
    return None


def find_item_lists(obj, path="$", out=None, depth=0):
    """Find lists of objects that look like menu items anywhere in a JSON tree."""
    if out is None:
        out = []
    if depth > 25:
        return out
    if isinstance(obj, list):
        dicts = [x for x in obj if isinstance(x, dict)]
        if len(dicts) >= 3:
            named = [d for d in dicts if item_name(d)]
            foody = sum(1 for d in named if any(STRONG_KEY_RE.search(k) for k in d))
            if len(named) >= 3 and foody >= 0.5 * len(named):
                out.append((path, named))
        for i, x in enumerate(obj[:1000]):
            find_item_lists(x, f"{path}[{i}]", out, depth + 1)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            find_item_lists(v, f"{path}.{k}", out, depth + 1)
    return out


def slim_item(d: dict) -> dict:
    out = {"name": item_name(d)}
    for k, v in d.items():
        if isinstance(v, bool) or v is None:
            continue
        if isinstance(v, (str, int, float)) and (k in NAME_KEYS or KEEP_KEY_RE.search(k)):
            out.setdefault(k, v[:400] if isinstance(v, str) else v)
        elif isinstance(v, dict) and re.search(r"nutri|calor", k, re.I):
            cal = {kk: vv for kk, vv in v.items()
                   if re.search(r"calor|energy", kk, re.I) and isinstance(vv, (int, float, str))}
            if cal:
                out[k] = cal
    return out


def menu_items_from_json(data) -> list[dict]:
    items, seen = [], set()
    for path, lst in find_item_lists(data):
        for d in lst:
            s = slim_item(d)
            key = (s["name"] or "").lower()
            if key and key not in seen:
                seen.add(key)
                s["_path"] = path
                items.append(s)
    return items


# ======================= robots & sitemaps =======================
_robots: dict[str, RobotFileParser | None] = {}


async def get_robots(http, url) -> RobotFileParser | None:
    p = urlparse(url)
    root = f"{p.scheme}://{p.netloc}"
    if root not in _robots:
        rp = None
        try:
            r = await limited(http.get(f"{root}/robots.txt", timeout=15), 25)
            if r.status_code < 400:
                rp = RobotFileParser()
                rp.parse(r.text.splitlines())
        except (httpx.HTTPError, asyncio.TimeoutError):
            pass
        _robots[root] = rp
    return _robots[root]


async def allowed(http, url) -> bool:
    rp = await get_robots(http, url)
    return True if rp is None else rp.can_fetch(BOT_NAME, url)


async def sitemap_seeds(http, website, base, menu_path) -> list[tuple[str, int]]:
    rp = await get_robots(http, website)
    queue = list((rp.site_maps() or []) if rp else [])
    queue += [website.rstrip("/") + "/sitemap.xml", website.rstrip("/") + "/sitemap_index.xml"]
    seen, found, files = set(), {}, 0
    while queue and files < MAX_SITEMAP_FILES:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            r = await limited(http.get(sm, timeout=20), 45)
            if r.status_code >= 400:
                continue
            content = r.content
            if content[:2] == b"\x1f\x8b":
                content = gzip.decompress(content)
            xml = content.decode("utf-8", "ignore")
        except Exception:
            continue
        files += 1
        locs = [htmllib.unescape(x).strip()
                for x in re.findall(r"<loc>\s*(.*?)\s*</loc>", xml, re.I | re.S)]
        if "<sitemapindex" in xml.lower():
            kids = [k for k in locs
                    if not re.search(r"store|locat|blog|news|career|job|/es|espanol", k, re.I)]
            kids = [k for k in kids if not foreign_locale(k)]
            kids.sort(key=lambda u: -((5 if re.search(r"(^|[^a-z])(en[-_]us|us[-_]en|us)([^a-z]|$)", u, re.I) else 0)
                                      + (3 if re.search(r"menu|product|food|nutrition|item", u, re.I)
                                         else 1 if re.search(r"page|main|default", u, re.I) else 0)))
            queue = kids + queue
        else:
            for u in locs:
                if same_site(u, base) and "?" not in u:
                    s = link_score(u, "", menu_path)
                    if s >= 6:
                        found[norm(u)] = s
    return sorted(found.items(), key=lambda x: -x[1])[:MAX_SITEMAP_SEEDS]


# ======================= url helpers =======================
def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def norm(url: str) -> str:
    url, _ = urldefrag(url)
    p = urlparse(url)
    q = "&".join(x for x in p.query.split("&")
                 if x and not x.lower().startswith(("utm_", "gclid", "fbclid", "cid=")))
    path = p.path.rstrip("/") or "/"
    return f"{p.scheme}://{p.netloc.lower()}{path}" + (f"?{q}" if q else "")


def base_domain(url: str) -> str:
    host = urlparse(url).netloc.lower().split(":")[0].removeprefix("www.")
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 and not parts[-1].isdigit() else host


def same_site(url: str, base: str) -> bool:
    host = urlparse(url).netloc.lower().split(":")[0]
    return host == base or host.endswith("." + base)


# ======================= browser actions =======================
CONSENT_BUTTONS = re.compile(r"^(accept( all)?( cookies)?|allow all|i agree|agree|got it|ok|okay|"
                             r"no,? thanks|dismiss|continue)$", re.I)
MORE_BUTTONS = re.compile(r"(load|show|view|see)\s+(more|all)", re.I)
STORE_PICK = re.compile(r"order here|select( this)?( store| location| restaurant)?$|"
                        r"start (your )?order|choose|this location|view menu|order now", re.I)


async def dismiss_overlays(page):
    try:
        btns = page.get_by_role("button", name=CONSENT_BUTTONS)
        for i in range(min(await btns.count(), 3)):
            b = btns.nth(i)
            if await b.is_visible():
                await b.click(timeout=1500)
                await page.wait_for_timeout(400)
    except Exception:
        pass


async def scroll_to_bottom(page, max_rounds=15):
    last = 0
    for _ in range(max_rounds):
        h = await limited(page.evaluate("document.body ? document.body.scrollHeight : 0"), 10)
        if h == last:
            break
        last = h
        await page.mouse.wheel(0, 4000)
        await page.wait_for_timeout(500)


async def safe_click(page, locator) -> bool:
    """Click without leaving the page; go back if the click navigated."""
    before = page.url
    try:
        await locator.click(timeout=2000)
        await page.wait_for_timeout(700)
    except Exception:
        return False
    if norm(page.url) != norm(before):
        try:
            await page.go_back(wait_until="domcontentloaded", timeout=15000)
        except Exception:
            pass
        return False
    return True


async def click_load_more(page, max_clicks=10):
    """Keep pressing 'Load more' / 'Show all' until it disappears."""
    for _ in range(max_clicks):
        btn = page.get_by_role("button", name=MORE_BUTTONS)
        try:
            if await btn.count() == 0 or not await btn.first.is_visible():
                break
        except Exception:
            break
        if not await safe_click(page, btn.first):
            break
        await scroll_to_bottom(page, 5)


async def read_menu(page) -> dict:
    try:
        return await limited(page.evaluate(MENU_JS), 45)
    except Exception as e:
        return {"isMenu": False, "items": 0, "menuText": "", "pageText": "", "title": "",
                "error": str(e)[:200]}


async def expand_and_read(page) -> dict:
    """Open everything hidden behind JS, read the menu after each step, combine."""
    await scroll_to_bottom(page)
    await click_load_more(page)

    scope = page.locator("main") if await page.locator("main").count() else page.locator("body")
    try:                                   # accordions / collapsed sections
        acc = scope.locator('[aria-expanded="false"]')
        for i in range(min(await acc.count(), 25)):
            a = acc.nth(i)
            if await a.is_visible():
                await safe_click(page, a)
    except Exception:
        pass

    reads = [await read_menu(page)]
    try:                                   # tabs swap content: read after each one
        tabs = scope.locator('[role="tab"]')
        for i in range(min(await tabs.count(), 20)):
            t = tabs.nth(i)
            if await t.is_visible() and await safe_click(page, t):
                await scroll_to_bottom(page, 4)
                await click_load_more(page, 5)
                reads.append(await read_menu(page))
    except Exception:
        pass

    text = merge_texts([r.get("menuText", "") for r in reads])
    return {
        "isMenu": any(r.get("isMenu") for r in reads),
        "menuText": text,
        "items": sum(1 for ln in text.splitlines() if ln.startswith("- ")),
        "pageText": reads[0].get("pageText", ""),
        "title": reads[0].get("title", ""),
    }


async def try_location_gate(page, zip_code: str) -> bool:
    selectors = ['input[placeholder*="zip" i]', 'input[placeholder*="address" i]',
                 'input[placeholder*="city" i]', 'input[placeholder*="location" i]',
                 'input[aria-label*="zip" i]', 'input[aria-label*="address" i]',
                 'input[aria-label*="location" i]', 'input[name*="zip" i]',
                 'input[type="search"]']
    for sel in selectors:
        try:
            box = page.locator(sel).first
            if await box.count() and await box.is_visible():
                await box.fill(zip_code, timeout=3000)
                await box.press("Enter")
                await page.wait_for_timeout(4000)
                pick = page.get_by_role("button", name=STORE_PICK)
                if await pick.count() and await pick.first.is_visible():
                    await pick.first.click(timeout=3000)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    return True
                return False
        except Exception:
            continue
    return False


async def embedded_items(page) -> list[dict]:
    try:
        blobs = await limited(page.evaluate(EMBED_JS), 20)
    except Exception:
        return []
    items = []
    for raw in blobs:
        try:
            items += menu_items_from_json(json.loads(raw))
        except Exception:
            pass
    return items


# ======================= the crawl =======================
async def crawl_restaurant(browser, http, row: dict, args) -> dict:
    name, website, menu_url = row["name"], row["website"], row["menu_url"]
    folder = OUTPUT_DIR / slugify(name)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*"):
        old.unlink()

    base = base_domain(website or menu_url)
    menu_path = urlparse(menu_url).path.lower()
    manifest = {"restaurant_name": name, "website": website, "menu_url": menu_url,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "visited": [], "saved": [], "pdfs": [], "json_sources": [],
                "location_gate": None, "errors": []}

    # ---- seeds: given menu URL, homepage, sitemap ----
    heap, counter, queued = [], 0, set()

    def push(url, priority, depth, via):
        nonlocal counter
        u = norm(url)
        if u in queued or not same_site(u, base):
            return
        queued.add(u)
        counter += 1
        heapq.heappush(heap, (-priority, counter, u, depth, via))

    push(menu_url, 100, 0, "csv")
    push(website, 20, 0, "homepage")
    try:
        for u, s in await limited(sitemap_seeds(http, website, base, menu_path), 180):
            push(u, s, 1, "sitemap")
        manifest["sitemap_seeds"] = sum(1 for h in heap if h[4] == "sitemap")
    except Exception as e:
        manifest["errors"].append(f"sitemap: {e}")

    # ---- browser with JSON capture ----
    context = await browser.new_context(user_agent=USER_AGENT, locale="en-US",
                                        viewport={"width": 1366, "height": 900})

    async def block_heavy(route):
        req = route.request
        if req.resource_type in ("image", "media", "font"):
            await route.abort()
            return
        if URL_GUARD is None:
            await route.continue_()
            return
        # URL_GUARD (set by crawl_places.py) is an early, cheap refusal of private/internal addresses. It is NOT the
        # security boundary: Chromium follows redirects by itself without asking again. The boundary is the local
        # filtering proxy (egress_proxy.py) that all browser traffic goes through.
        if not await URL_GUARD(req.url):
            await route.abort()
            return
        await route.continue_()
    await context.route("**/*", block_heavy)

    captured: dict[str, bytes] = {}
    pending = []

    async def grab(resp):
        try:
            if resp.request.resource_type not in ("xhr", "fetch"):
                return
            if "json" not in (resp.headers.get("content-type") or "").lower():
                return
            body = await limited(resp.body(), 10)
            if 50 < len(body) <= MAX_JSON_BYTES and resp.url not in captured:
                captured[resp.url] = body
        except Exception:
            pass

    def auto_dismiss(dialog):          # alert()/confirm() would freeze the page
        pending.append(asyncio.create_task(dialog.dismiss()))

    async def fresh_page():
        pg = await limited(context.new_page(), 30)
        pg.on("response", lambda r: pending.append(asyncio.create_task(grab(r))))
        pg.on("dialog", auto_dismiss)
        return pg

    page = await fresh_page()

    # Offline reader for pages fetched with a plain request (used when a site
    # blocks the automated browser). It makes no network requests of its own:
    # it just lays out the page so the same menu detector can read it.
    static_ctx = await browser.new_context(locale="en-US", viewport={"width": 1366, "height": 900})

    async def no_network(route):
        await route.abort()
    await static_ctx.route("**/*", no_network)
    static_page = await static_ctx.new_page()
    static_page.on("dialog", auto_dismiss)

    menus: list[tuple[float, str, str]] = []          # (score, url, menu text)
    embedded: list[tuple[str, list]] = []
    pdf_links: dict[str, int] = {}
    visits = 0
    mode = "browser"           # becomes "plain" if the site blocks the browser
    blocked_streak = 0

    async def visit_browser(url, entry):
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            msg = err_text(e, 150)
            if BLOCK_ERR_RE.search(msg):
                raise SiteBlocked(msg)
            raise
        status = resp.status if resp else 0
        entry["status"] = status
        if status in BLOCK_STATUS:
            raise SiteBlocked(f"HTTP {status}")
        if status >= 400:
            entry["result"] = f"HTTP {status}"
            return None
        try:
            await page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        title = await limited(page.title(), 10)
        if BLOCK_TITLE_RE.search(title or ""):
            raise SiteBlocked(f"bot-check page: {title[:60]}")
        await dismiss_overlays(page)
        read = await expand_and_read(page)

        # "choose a store" pages
        if not read["isMenu"] and GATE_RE.search(read["pageText"][:3000]):
            entry["gated"] = True
            if args.zip and manifest["location_gate"] is None:
                ok = await try_location_gate(page, args.zip)
                manifest["location_gate"] = "passed" if ok else "failed"
                if ok:
                    read = await expand_and_read(page)
            elif manifest["location_gate"] is None:
                manifest["location_gate"] = "seen (use --zip)"

        items = await embedded_items(page)
        if len(items) >= 3:
            embedded.append((page.url, items))
        links = await limited(page.eval_on_selector_all("a[href]", LINKS_JS), 20)
        return read, links, page.url

    async def visit_plain(url, entry):
        try:
            r = await limited(http.get(url, timeout=30), 45)
        except Exception as e:
            entry["result"] = f"plain request failed: {err_text(e)}"
            return None
        entry["plain_status"] = r.status_code
        if r.status_code >= 400:
            entry["result"] = f"HTTP {r.status_code} (plain request)"
            return None
        if "html" not in (r.headers.get("content-type") or "").lower():
            entry["result"] = "not an HTML page"
            return None
        final = str(r.url)
        html = r.text
        base_tag = f'<base href="{htmllib.escape(final, quote=True)}">'
        html, n = re.subn(r"<head[^>]*>", lambda m: m.group(0) + base_tag, html, count=1, flags=re.I)
        if not n:
            html = base_tag + html
        await static_page.set_content(html, wait_until="domcontentloaded", timeout=30000)
        if BLOCK_TITLE_RE.search(await limited(static_page.title(), 10) or ""):
            entry["result"] = "bot-check page (plain request)"
            return None
        raw = await read_menu(static_page)
        text = merge_texts([raw.get("menuText", "")])
        read = {"isMenu": raw.get("isMenu", False), "menuText": text,
                "items": sum(1 for ln in text.splitlines() if ln.startswith("- ")),
                "pageText": raw.get("pageText", ""), "title": raw.get("title", "")}
        items = await embedded_items(static_page)
        if len(items) >= 3:
            embedded.append((final, items))
        links = await limited(static_page.eval_on_selector_all("a[href]", LINKS_JS), 20)
        return read, links, final

    async def visit_page(url, entry):
        """Browser first; if the site blocks it, switch to plain requests."""
        nonlocal mode, blocked_streak
        if mode == "browser":
            try:
                result = await visit_browser(url, entry)
                blocked_streak = 0
                return result
            except SiteBlocked as b:
                entry["browser_blocked"] = str(b)
                result = await visit_plain(url, entry)
                if result:
                    mode = "plain"
                    manifest["mode"] = "plain requests (site blocks the automated browser)"
                    blocked_streak = 0
                else:
                    blocked_streak += 1
                return result
        return await visit_plain(url, entry)

    try:
        while heap and visits < args.max_pages:
            negp, _, url, depth, via = heapq.heappop(heap)
            if not await allowed(http, url):
                manifest["visited"].append({"url": url, "result": "robots.txt disallows"})
                continue
            visits += 1
            entry = {"url": url, "via": via, "depth": depth, "priority": -negp}
            if args.verbose:
                print(f"    [{name}] {mode:<7} {url}", flush=True)
            try:
                result = await limited(visit_page(url, entry), args.page_timeout)
            except asyncio.TimeoutError:
                entry["result"] = f"page timed out after {args.page_timeout}s"
                try:                                   # the tab may be frozen: replace it
                    await limited(page.close(), 10)
                except Exception:
                    pass
                try:
                    page = await fresh_page()
                except Exception as e:
                    manifest["errors"].append(f"could not open a new tab: {err_text(e)}")
                    manifest["visited"].append(entry)
                    break
                result = None
            except Exception as e:
                entry["result"] = f"error: {err_text(e)}"
                result = None
            try:
                if result:
                    read, links, final = result
                    score = menu_score(read["menuText"])
                    entry.update(final_url=final, mode=mode, title=read["title"],
                                 is_menu=read["isMenu"], items=read["items"], score=score,
                                 result="menu found" if read["isMenu"] else "no menu on page")
                    if read["isMenu"]:
                        menus.append((score, final, read["menuText"]))
                    bonus = 3 if read["isMenu"] else 0
                    # items already captured on this page: their detail pages add little
                    got = {ln[2:].split(" | ")[0].strip().lower()
                           for ln in read["menuText"].splitlines() if ln.startswith("- ")}
                    for href, ltxt in links:
                        if not href.startswith("http") or not same_site(href, base):
                            continue
                        s = link_score(href, ltxt, menu_path)
                        if ltxt.strip().lower() in got:
                            s -= 8
                        if s <= 0:
                            continue
                        if href.lower().split("?")[0].endswith(".pdf"):
                            pdf_links[href] = max(pdf_links.get(href, 0), s)
                        elif depth + 1 <= MAX_DEPTH:
                            push(href, s + bonus - 2 * depth, depth + 1, f"link from {url}")
                elif "result" not in entry:
                    entry["result"] = "blocked"
            except Exception as e:
                entry["result"] = f"error: {err_text(e)}"
            manifest["visited"].append(entry)
            if blocked_streak >= 3 and not menus:
                manifest["errors"].append(
                    "Site blocks both the automated browser and plain requests; stopped early. "
                    "Use another source for this chain (e.g. its nutrition PDF or a licensed data API).")
                break
            await asyncio.sleep(PAGE_DELAY)
    finally:
        if pending:
            done_tasks, stuck = await asyncio.wait(pending, timeout=15)
            for t in stuck:
                t.cancel()
        for ctx in (context, static_ctx):
            try:
                await limited(ctx.close(), 20)
            except Exception:
                pass

    # ---- save: menu text, best first ----
    menus.sort(key=lambda x: -x[0])
    seen_text, n = set(), 0
    for score, url, text in menus[:15]:
        if text in seen_text:
            continue
        seen_text.add(text)
        n += 1
        fname = f"page_{n:02d}.txt"
        (folder / fname).write_text(f"SOURCE: {url}\n\n{text}", encoding="utf-8")
        manifest["saved"].append({"file": fname, "url": url, "score": score,
                                  "items": sum(1 for ln in text.splitlines() if ln.startswith("- "))})

    # ---- save: JSON from API calls and embedded data ----
    all_names = {}

    def save_json(prefix, idx, url, items):
        fname = f"{prefix}_{idx:02d}.json"
        (folder / fname).write_text(json.dumps({"source": url, "items": items},
                                               indent=1, ensure_ascii=False), encoding="utf-8")
        manifest["json_sources"].append({"file": fname, "url": url, "items": len(items)})
        for it in items:
            all_names.setdefault(it["name"].lower(), it["name"])

    j = 0
    for url, body in captured.items():
        try:
            items = menu_items_from_json(json.loads(body))
        except Exception:
            continue
        if len(items) >= 3:
            j += 1
            save_json("api", j, url, items)
    for e, (url, items) in enumerate(embedded, 1):
        save_json("embedded", e, url, items)
    if all_names:
        (folder / "items_index.txt").write_text("\n".join(sorted(all_names.values())) + "\n",
                                                encoding="utf-8")

    # ---- save: PDFs ----
    for i, (url, _) in enumerate(sorted(pdf_links.items(), key=lambda x: -x[1])[:MAX_PDFS if SAVE_PDFS else 0], 1):
        try:
            if not await allowed(http, url):
                continue
            r = await limited(http.get(url, timeout=60), 120)
            if r.status_code < 400 and r.content.startswith(b"%PDF") and len(r.content) <= MAX_PDF_BYTES:
                fname = f"pdf_{i:02d}.pdf"
                (folder / fname).write_bytes(r.content)
                manifest["pdfs"].append({"file": fname, "url": url, "bytes": len(r.content)})
        except Exception as ex:
            manifest["errors"].append(f"pdf {url}: {ex}")

    # ---- verdict ----
    page_items = len({ln.strip().lower() for _, _, t in menus for ln in t.splitlines()
                      if ln.startswith("- ")})
    manifest.update(
        pages_visited=visits, menu_pages=len(manifest["saved"]), page_items=page_items,
        json_items=len(all_names), pdf_count=len(manifest["pdfs"]),
        best_url=menus[0][1] if menus else None,
        finished_at=datetime.now(timezone.utc).isoformat())
    if len(all_names) >= 15 or page_items >= 15:
        manifest["status"] = "good"
    elif all_names or menus or manifest["pdfs"]:
        manifest["status"] = "weak"
    else:
        manifest["status"] = "empty"
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
    return manifest


# ======================= main =======================
def load_rows(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name = (r.get("restaurant_name") or "").strip()
            menu_url = (r.get("menu_url") or r.get("url") or "").strip()
            website = (r.get("website") or "").strip()
            if not website and menu_url:
                p = urlparse(menu_url)
                website = f"{p.scheme}://{p.netloc}"
            if not menu_url:
                menu_url = website
            if name and website:
                rows.append({"name": name, "website": website, "menu_url": menu_url})
    return rows


def read_manifest(name):
    m = OUTPUT_DIR / slugify(name) / "manifest.json"
    try:
        return json.loads(m.read_text(encoding="utf-8")) if m.exists() else None
    except Exception:
        return None


def write_report(rows):
    with open(REPORT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["restaurant_name", "status", "page_items", "json_items", "menu_pages",
                    "pdfs", "pages_visited", "location_gate", "best_url"])
        for r in rows:
            m = read_manifest(r["name"])
            if not m:
                w.writerow([r["name"], "not crawled", "", "", "", "", "", "", ""])
                continue
            w.writerow([r["name"], m.get("status"), m.get("page_items"), m.get("json_items"),
                        m.get("menu_pages"), m.get("pdf_count"), m.get("pages_visited"),
                        m.get("location_gate") or "", m.get("best_url") or ""])


async def main():
    ap = argparse.ArgumentParser(description="Crawl restaurant sites for their menus.")
    ap.add_argument("--chains", default="chains.csv")
    ap.add_argument("--only", help="crawl just this restaurant")
    ap.add_argument("--limit", type=int, help="only the first N rows")
    ap.add_argument("--workers", type=int, default=3, help="restaurants in parallel")
    ap.add_argument("--max-pages", type=int, default=MAX_PAGES, help="pages per restaurant")
    ap.add_argument("--zip", help="ZIP code to use when a site asks you to pick a store")
    ap.add_argument("--force", action="store_true", help="re-crawl everything")
    ap.add_argument("--retry-weak", action="store_true", help="re-crawl weak/empty results")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--verbose", action="store_true", help="print every page as it is visited")
    ap.add_argument("--page-timeout", type=int, default=PAGE_TIMEOUT,
                    help=f"seconds before giving up on one page (default {PAGE_TIMEOUT})")
    ap.add_argument("--restaurant-timeout", type=int, default=RESTAURANT_TIMEOUT,
                    help=f"seconds before giving up on one restaurant (default {RESTAURANT_TIMEOUT})")
    args = ap.parse_args()

    all_rows = load_rows(args.chains)
    rows = all_rows
    if args.only:
        rows = [r for r in rows if r["name"].lower() == args.only.lower()]
        if not rows:
            sys.exit(f"No restaurant named {args.only!r} in {args.chains}")
    if args.limit:
        rows = rows[:args.limit]

    todo = []
    for r in rows:
        m = read_manifest(r["name"])
        if args.force or args.only or m is None or \
                (args.retry_weak and m.get("status") in ("weak", "empty")):
            todo.append(r)
    print(f"{len(rows)} restaurants, {len(rows) - len(todo)} already done, crawling {len(todo)}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    sem = asyncio.Semaphore(max(1, args.workers))
    done = 0
    async with async_playwright() as p, httpx.AsyncClient(
            headers=PLAIN_HEADERS, follow_redirects=True, http2=False) as http:
        browser = await p.chromium.launch(headless=not args.headed)
        relaunch_lock = asyncio.Lock()

        async def live_browser():
            """Relaunch Chromium if it crashed (e.g. the server ran low on memory)."""
            nonlocal browser
            async with relaunch_lock:
                if not browser.is_connected():
                    print("    browser stopped responding; restarting it", flush=True)
                    browser = await p.chromium.launch(headless=not args.headed)
            return browser

        async def worker(row):
            nonlocal done
            async with sem:
                try:
                    b = await live_browser()
                    m = await limited(crawl_restaurant(b, http, row, args), args.restaurant_timeout)
                    msg = (f"{m['status']:<5} {row['name']}: {m['page_items']} items on "
                           f"{m['menu_pages']} menu page(s), {m['json_items']} JSON items, "
                           f"{m['pdf_count']} PDF(s), {m['pages_visited']} visited"
                           + (f", store picker {m['location_gate']}" if m['location_gate'] else ""))
                except asyncio.TimeoutError:
                    m = {"restaurant_name": row["name"], "website": row["website"],
                         "menu_url": row["menu_url"], "status": "empty", "visited": [],
                         "errors": [f"gave up after {args.restaurant_timeout}s"]}
                    folder = OUTPUT_DIR / slugify(row["name"])
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "manifest.json").write_text(json.dumps(m, indent=2), encoding="utf-8")
                    msg = f"TIME  {row['name']}: gave up after {args.restaurant_timeout}s (moving on)"
                except Exception as e:
                    with open("crawl_errors.log", "a", encoding="utf-8") as lf:
                        lf.write(f"\n=== {datetime.now().isoformat()} {row['name']}\n")
                        lf.write(traceback.format_exc())
                    msg = f"FAIL  {row['name']}: {err_text(e)} (details in crawl_errors.log)"
                done += 1
                print(f"[{done}/{len(todo)}] {msg}", flush=True)

        await asyncio.gather(*(worker(r) for r in todo))
        try:
            await limited(browser.close(), 30)
        except Exception:
            pass

    write_report(all_rows)
    counts = Counter((read_manifest(r["name"]) or {}).get("status", "not crawled") for r in rows)
    print(f"\nDone: {dict(counts)}. Details in {REPORT_CSV}.")


if __name__ == "__main__":
    asyncio.run(main())