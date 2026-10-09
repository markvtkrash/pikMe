"""Turns what the reader saved for one restaurant into a list of dish names, and decides how the crawl went.

The reader (menu_reader.py) writes page_NN.txt files with one line per menu card, "- Name | 550 Cal | description",
and api_NN.json / embedded_NN.json files with items found in the page's data. Only the DISH NAMES go to the server,
which estimates nutrition itself and adds the dishes to the right restaurant by its place ID.
"""

import json
import re
from pathlib import Path

MAX_NAMES = 300
MIN_NAMES_FOR_OK = 3
# JSON items are noisier than the cards on screen (they can include categories and modifiers), so they are only
# used to top up a page that gave very few names.
USE_JSON_BELOW = 5

_PRICE_RE = re.compile(r"\$\s?\d{1,3}(?:\.\d{2})?")
_CAL_RE = re.compile(r"\b\d{1,4}(?:\s*[-–/]\s*\d{1,4})?\s*(?:cal|cals|calories|kcal)\b\.?", re.I)
_JUNK = {
    "new", "popular", "limited time", "best seller", "bestseller", "best sellers", "featured", "sold out",
    "vegan", "vegetarian", "gluten free", "gluten-free", "spicy", "add", "order", "order now", "view", "menu",
    "specials", "special", "deals", "home", "sale", "free", "most popular", "chef's pick", "recommended",
}


_CODE_EXT_RE = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js|json|ico|mp4|pdf)$", re.I)
_SLUG_RE = re.compile(r"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$")


def looks_like_code_name(name):
    """True for text that is code or a file reference, not a dish: a path ("customer-stories/logos/cafe"), a file name
    ("menu.png"), an address, or a slug (all lowercase words joined by - or _, with no spaces: "orange-right-arrow").
    Page data carries lots of these; real menu names have spaces and capitals. A name that starts with a digit
    ("7-up") is not treated as a slug."""
    t = str(name or "").strip()
    if not t:
        return False
    return bool(
        re.search(r"[\\/]", t)
        or _CODE_EXT_RE.search(t)
        or re.match(r"^(https?://|www\.)", t, re.I)
        or _SLUG_RE.match(t)
    )


def clean_name(raw):
    """A tidy dish name, or None when the text is not one (a price, a badge, code or a file name, too short or long)."""
    if not isinstance(raw, str):
        return None
    name = _PRICE_RE.sub("", raw)
    name = _CAL_RE.sub("", name)
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"^[\s\-–—•*·.,:;|]+|[\s\-–—•*·.,:;|]+$", "", name).strip()
    if len(name) < 2 or len(name) > 80:
        return None
    if not re.search(r"[A-Za-z]", name):
        return None
    if name.lower() in _JUNK:
        return None
    if looks_like_code_name(name):
        return None
    return name


def names_from_menu_text(text):
    """The first part of every "- Name | ..." card line."""
    out = []
    for line in (text or "").splitlines():
        if not line.startswith("- "):
            continue
        name = clean_name(line[2:].split(" | ")[0])
        if name:
            out.append(name)
    return out


def names_from_json(data):
    """Names from a saved api_NN.json / embedded_NN.json ({"source": ..., "items": [{"name": ...}, ...]})."""
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        name = clean_name(it.get("name") if isinstance(it, dict) else None)
        if name:
            out.append(name)
    return out


def _unique(names, limit=MAX_NAMES):
    seen, out = set(), []
    for n in names:
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(n)
        if len(out) >= limit:
            break
    return out


def page_card_names(folder):
    """Dish names from the menu cards on the pages only (never from the page's data): the trustworthy ones."""
    folder = Path(folder)
    names = []
    for f in sorted(folder.glob("page_*.txt")):
        try:
            names += names_from_menu_text(f.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    return _unique(names)


def collect_names(folder):
    """Dish names for one restaurant from the files the reader saved in `folder`, best page first."""
    folder = Path(folder)
    text_names = []
    for f in sorted(folder.glob("page_*.txt")):
        try:
            text_names += names_from_menu_text(f.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    names = _unique(text_names)

    if len(names) < USE_JSON_BELOW:
        json_names = []
        for f in sorted(list(folder.glob("api_*.json")) + list(folder.glob("embedded_*.json"))):
            try:
                json_names += names_from_json(json.loads(f.read_text(encoding="utf-8", errors="ignore")))
            except (OSError, ValueError):
                continue
        names = _unique(names + json_names)
    return names


TEXT_LIMIT = 60000


def collect_text(folder, limit=TEXT_LIMIT):
    """The menu text for one restaurant, for the server's AI to read the dishes from.

    The saved page files in reading order (best page first), without the "SOURCE:" header lines, with repeated lines
    dropped, cut at a line boundary within `limit` characters. If the pages gave very few menu lines, the names found
    in the page's data are added as extra "- name" lines.
    """
    folder = Path(folder)
    lines, seen = [], set()

    def add(line):
        text = line.rstrip()
        key = text.strip().lower()
        if not key:
            if lines and lines[-1] != "":
                lines.append("")
            return
        if key in seen:
            return
        seen.add(key)
        lines.append(text)

    for f in sorted(folder.glob("page_*.txt")):
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for ln in content.splitlines():
            if ln.startswith("SOURCE:"):
                continue
            add(ln)

    if sum(1 for ln in lines if ln.startswith("- ")) < USE_JSON_BELOW:
        extra = []
        for f in sorted(list(folder.glob("api_*.json")) + list(folder.glob("embedded_*.json"))):
            try:
                extra += names_from_json(json.loads(f.read_text(encoding="utf-8", errors="ignore")))
            except (OSError, ValueError):
                continue
        if extra:
            add("")
            add("## Data found in the page code")
            for n in _unique(extra):
                add(f"- {n}")

    out, size = [], 0
    for ln in lines:
        if size + len(ln) + 1 > limit:
            break
        out.append(ln)
        size += len(ln) + 1
    return "\n".join(out).strip()


_READ_OK = ("menu found", "no menu on page")


def decide_status(names, manifest):
    """('ok' | 'no_items' | 'error', detail).

    ok        three or more dishes were found.
    no_items  the pages were read fine but held no dish list: nothing to retry until the link changes.
    error     no page could be read at all (blocked, unreachable, timed out): worth trying again later.
    """
    if len(names) >= MIN_NAMES_FOR_OK:
        return "ok", f"{len(names)} dishes found on {manifest.get('menu_pages', 0)} page(s)"

    visited = manifest.get("visited") or []
    read_ok = sum(1 for v in visited if v.get("result") in _READ_OK)
    if read_ok == 0:
        reasons = [v.get("result") for v in visited if v.get("result")][:2] + list(manifest.get("errors") or [])[:1]
        detail = "; ".join(str(r) for r in reasons if r) or "no page could be read"
        return "error", detail[:300]
    return "no_items", f"the page was read but only {len(names)} dish name(s) were found"
