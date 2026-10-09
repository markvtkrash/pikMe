# Menu crawl worker

Reads the menu link of independent restaurants in a real browser (Playwright) and adds the dishes to the right
restaurant's menu. Runs from `cron` on the same VPS as Supabase.

## How it fits together

```
every owner save of the  ─┐                       ┌─ crawl_places.py (this folder, cron once a day)
menu link (same or new),  │                       │
every admin override save ─┴─> place_menu_crawl ─> │    1. asks for work      ─┐
                              (migration 114)      │    2. reads the page      │  menu-crawl edge function
                                                   │    3. sends the MENU TEXT ┘  (checks the secret)
                                                   └─────────────────────────> get-chain-menu (place mode):
                                                        the AI reads the dishes out of the text (and any calories
                                                        the page states), estimates nutrition, ADDS the dishes to
                                                        that restaurant by its Google place ID (new = verified,
                                                        AI guesses confirmed, nothing replaced or removed)
```

* The worker never holds the database key or an AI key. It only has a secret that lets it ask for work and post results.
* **Every save marks the restaurant for the next run**, even when the link is unchanged (the page behind it may have
  changed): the owner's Save of the menu page URL (Menu Management page) or menu-link upload, and the admin's
  override-link save. Saving the owner's Profile page does not, because it no longer touches the menu link. A save that arrives
  while its restaurant is being read is kept for the next read.
* Franchises are skipped by the server. An admin's override link wins over the owner's link.
* A page it could not read is an `error` (retried after 6 hours, flagged `needs_attention` after 3 failures). A page it
  read that held no dish list is `no_items` and is left alone until the link changes. A page with too few dishes never
  changes an existing menu.

## Files

| File | What it is |
|---|---|
| `crawl_places.py` | the worker you run |
| `menu_reader.py` | the page reader, copied from `crawl_menus.py` (finds the menu by how it looks on screen; handles tabs, "load more", embedded data, API calls, PDFs). Two edits: an optional address guard, and nothing else changes its reading |
| `egress_proxy.py` | a local filtering proxy; the **security boundary**: all browser and HTTP traffic goes through it and it only connects to public internet addresses (redirects and DNS tricks cannot get around it) |
| `safety.py` | address checks (early, friendly refusals) |
| `items.py` | collects the menu text (and a fallback list of dish names) from the saved pages and decides ok / no_items / error |
| `tests/` | `python -m unittest discover -s tests` (the browser test is skipped if Chromium is not installed) |

## One-time setup on the VPS

```bash
# 1. put this folder on the VPS, e.g. /opt/pikme/crawler, then:
cd /opt/pikme/crawler
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/playwright install --with-deps chromium     # needs root for the system libraries

# 2. a secret for the worker (keep it out of git)
openssl rand -hex 32
```

In the Supabase SQL editor (use the secret from step 2):

```sql
insert into internal_settings (key, value) values ('crawler_secret', 'PASTE-THE-SECRET-HERE')
on conflict (key) do update set value = excluded.value;
```

Create `/etc/pikme-crawler.env` (readable only by the user that runs cron: `chmod 600`):

```
# the same base address as your "functions_url" setting, plus /menu-crawl
CRAWLER_URL=http://localhost:8000/functions/v1/menu-crawl
CRAWLER_SECRET=PASTE-THE-SECRET-HERE
# the public "anon" API key; needed because edge functions check the caller's key by default
SUPABASE_ANON_KEY=PASTE-YOUR-ANON-KEY
```

Deploy the two edge functions (see the deploy list in the migration notes): `menu-crawl` (new) and `get-chain-menu`
(changed).

## Try it before scheduling it

```bash
# 1. read one page and print the dishes it finds; contacts no server, changes nothing
./venv/bin/python crawl_places.py --try https://some-restaurant.com/menu --verbose

# 2. a full run: set a menu link for a test restaurant in the owner app (or an override link in the admin tools),
#    check it is waiting:   select place_id, restaurant_name, link, status from place_menu_crawl;
./venv/bin/python crawl_places.py --env-file /etc/pikme-crawler.env --verbose
#    then look at that restaurant's menu in the admin Menu Management page
```

## Schedule it

Once a day (here 3:00 a.m.):

```
0 3 * * * cd /opt/pikme/crawler && ./venv/bin/python crawl_places.py --env-file /etc/pikme-crawler.env >> /var/log/pikme-crawler.log 2>&1
```

Each run works through what is waiting, asking the server for up to 5 restaurants at a time (`--limit`) and reading them
one after another (`--workers 1`), until nothing is left or the run limit is reached.

**The run limit is the `menuCrawlMaxPerRun` setting in `app_config`** (default 50, allowed 1 to 1000; change it on the
admin Config page, it applies to the next request, no redeploy). The worker tells the server how many it has taken
so far, and the server stops handing out work once that number reaches the limit. The oldest requests are read first and
the rest wait for the next run. The log says when a run stopped for this reason. `--max-total N` and `--max-minutes 240`
are extra local ceilings (off / 4 hours by default).

The script refuses to start while a previous run is still going. You can also run it by hand at any time to read what is
waiting right now (a hand run has the same limit). A restaurant whose read failed is retried by the next run once
6 hours have passed. Rotate the log with `logrotate` if you like.

Useful options: `--max-pages 6` (pages read per restaurant), `--restaurant-timeout 300`, `--keep` (keep the saved pages
under `./work` for inspection), `--headed` (watch the browser, on a desktop).

## Watching it

```sql
select status, count(*) from place_menu_crawl group by 1;
select restaurant_name, link, status, attempts, last_detail, finished_at
from place_menu_crawl where status in ('error', 'needs_attention', 'no_items') order by updated_at desc;
```

To read a link again, save it again (an owner or admin saving the same link is enough), or:
`update place_menu_crawl set status='pending', attempts=0, next_attempt_at=now() where place_id='...';`

## Safety notes

* Links are typed by restaurant owners, so the worker treats them as untrusted. Every connection goes through
  `egress_proxy.py`, which resolves the host itself and refuses unless every address is public and the port is an
  ordinary web port, then connects to the address it checked. A link to `localhost`, the VPS's own address, the
  Docker network or the cloud metadata address is refused, including through redirects.
* Run cron as an unprivileged user (not root and not the database user). As an extra layer you can also block that
  user's traffic to private ranges with the firewall (`iptables -m owner --uid-owner`).
* The worker identifies itself as `MenuCollectorBot` and follows `robots.txt` (inherited from `menu_reader.py`).
