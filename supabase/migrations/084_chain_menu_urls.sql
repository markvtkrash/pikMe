-- A built-in menu page per chain.
--
-- SerpApi's menu link comes and goes for the same store. When it is missing (and no
-- admin has entered a link by hand), get-chain-menu now tries this chain's menu_url
-- before guessing paths on the store's website. It is only a fallback: a link from
-- SerpApi, a stored link, or an admin's manual link always wins.
--
-- The seed below is a STARTING POINT written from general knowledge, not a verified
-- registry: sites change their menu addresses, and some block automated readers. A
-- wrong or dead address is harmless (the page is simply unreadable and the chain
-- keeps what it has), and an admin can always override one with a manual link on
-- the Chain Menus page. It only fills chains that have no menu_url yet, so re-running
-- never overwrites an address an admin has since edited. Safe to re-run.
ALTER TABLE public.franchise_chains
  ADD COLUMN IF NOT EXISTS menu_url TEXT;

COMMENT ON COLUMN public.franchise_chains.menu_url IS
  'Official menu page for the whole chain; used by get-chain-menu when SerpApi gives no menu link and no manual link is set.';

UPDATE public.franchise_chains fc
SET menu_url = v.url
FROM (VALUES
  ('McDonald''s',             'https://www.mcdonalds.com/us/en-us/full-menu.html'),
  ('Burger King',             'https://www.bk.com/menu'),
  ('Wendy''s',                'https://www.wendys.com/menu'),
  ('Taco Bell',               'https://www.tacobell.com/food'),
  ('Subway',                  'https://www.subway.com/en-us/menu'),
  ('Chick-fil-A',             'https://www.chick-fil-a.com/menu'),
  ('Starbucks',               'https://www.starbucks.com/menu'),
  ('Dunkin''',                'https://www.dunkindonuts.com/en/menu'),
  ('Dunkin'' Donuts',         'https://www.dunkindonuts.com/en/menu'),
  ('Panera Bread',            'https://www.panerabread.com/en-us/menu.html'),
  ('Whataburger',             'https://whataburger.com/menu'),
  ('Wingstop',                'https://www.wingstop.com/menu'),
  ('Noodles & Company',       'https://www.noodles.com/menu'),
  ('Corner Bakery Cafe',      'https://www.cornerbakerycafe.com/menu'),
  ('First Watch',             'https://www.firstwatch.com/menu'),
  ('Slim Chickens',           'https://slimchickens.com/menu'),
  ('Teriyaki Madness',        'https://teriyakimadness.com/menu'),
  ('Popeyes',                 'https://www.popeyes.com/menu'),
  ('KFC',                     'https://www.kfc.com/menu'),
  ('Arby''s',                 'https://www.arbys.com/menu'),
  ('Sonic Drive-In',          'https://www.sonicdrivein.com/menu'),
  ('Jack in the Box',         'https://www.jackinthebox.com/menu'),
  ('Culver''s',               'https://www.culvers.com/menu'),
  ('Five Guys',               'https://www.fiveguys.com/menu'),
  ('Panda Express',           'https://www.pandaexpress.com/menu'),
  ('Jimmy John''s',           'https://www.jimmyjohns.com/menu'),
  ('Jersey Mike''s Subs',     'https://www.jerseymikes.com/menu'),
  ('Firehouse Subs',          'https://www.firehousesubs.com/menu'),
  ('Raising Cane''s',         'https://www.raisingcanes.com/menu'),
  ('Zaxby''s',                'https://www.zaxbys.com/menu'),
  ('Qdoba',                   'https://www.qdoba.com/menu'),
  ('Moe''s Southwest Grill',  'https://www.moes.com/menu'),
  ('Papa John''s',            'https://www.papajohns.com/order/menu'),
  ('Applebee''s',             'https://www.applebees.com/en/menu'),
  ('Chili''s',                'https://www.chilis.com/menu'),
  ('Olive Garden',            'https://www.olivegarden.com/menu'),
  ('IHOP',                    'https://www.ihop.com/en/menu'),
  ('Denny''s',                'https://www.dennys.com/menu'),
  ('Tim Hortons',             'https://www.timhortons.com/menu'),
  ('Dairy Queen',             'https://www.dairyqueen.com/en-us/menu/')
) AS v(name, url)
WHERE fc.normalized_name = public.normalize_restaurant_name(v.name)
  AND fc.menu_url IS NULL;

NOTIFY pgrst, 'reload schema';
