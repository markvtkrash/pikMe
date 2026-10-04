-- Known US food franchises/chains. The consumer app treats a restaurant whose
-- name matches a row here as a chain: its menu is consistent everywhere and
-- widely published, so AI-estimated (unconfirmed) menu items are shown for it.
-- Anything not in this list only shows items the restaurant itself confirmed.
--
-- Matching is on a normalized name (see normalize_restaurant_name) and is an
-- EXACT match against the name or one of its aliases — deliberately not a
-- prefix/contains match, so e.g. "Subway Tile Cafe" never matches "Subway".
--
-- The seed list below is a starting point written from general knowledge, not
-- an authoritative registry. Admins can add, edit and deactivate rows from the
-- admin app's Franchise List page.

-- ── 1. Name normalization ───────────────────────────────────────────────────
-- "McDonald's #4521" -> "mcdonalds", "The Cheesecake Factory - Downtown" ->
-- "cheesecake factory", "Chick-fil-A" -> "chick fil a". Applied to both the
-- stored names and the name being looked up, so punctuation, store numbers,
-- trailing " - location" text, parenthesised text and a leading "The" never
-- cause a miss.
CREATE OR REPLACE FUNCTION public.normalize_restaurant_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(COALESCE(p_name, '')), '\s+[-–—]\s+.*$', ''),  -- " - Main St" suffix
              '\(.*?\)', ' ', 'g'),                                                 -- (parenthesised)
            '#\s*\d+', ' ', 'g'),                                                   -- store numbers
          '[''’`]', '', 'g'),                                                       -- apostrophes
        '&', ' and ', 'g'),
      '[^a-z0-9]+', ' ', 'g')
  );
$$;

-- ── 2. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.franchise_chains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- normalized_name is always derived from name, never typed by hand.
CREATE OR REPLACE FUNCTION public.franchise_chains_set_normalized()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_name := public.normalize_restaurant_name(NEW.name);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_franchise_chains_normalize ON public.franchise_chains;
CREATE TRIGGER trg_franchise_chains_normalize
  BEFORE INSERT OR UPDATE OF name ON public.franchise_chains
  FOR EACH ROW EXECUTE FUNCTION public.franchise_chains_set_normalized();

ALTER TABLE public.franchise_chains ENABLE ROW LEVEL SECURITY;

-- Readable by anyone — it's just a list of public chain names, and the
-- consumer app needs it to decide what to show.
DROP POLICY IF EXISTS "franchise_chains_select_all" ON public.franchise_chains;
CREATE POLICY "franchise_chains_select_all" ON public.franchise_chains
  FOR SELECT USING (true);

-- Only admins can add/change/remove rows.
DROP POLICY IF EXISTS "franchise_chains_admin_write" ON public.franchise_chains;
CREATE POLICY "franchise_chains_admin_write" ON public.franchise_chains
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- ── 3. Lookup ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_franchise_chain(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.franchise_chains fc
    WHERE fc.is_active
      AND public.normalize_restaurant_name(p_name) <> ''
      AND (
        fc.normalized_name = public.normalize_restaurant_name(p_name)
        OR EXISTS (
          SELECT 1 FROM unnest(fc.aliases) a
          WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(p_name)
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.normalize_restaurant_name(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_franchise_chain(TEXT) TO anon, authenticated;

-- ── 4. Seed ─────────────────────────────────────────────────────────────────
-- (name, category, aliases). Safe to re-run: existing rows are left alone.
INSERT INTO public.franchise_chains (name, category, aliases)
SELECT v.name, v.category, v.aliases
FROM (VALUES
  -- Burgers
  ('McDonald''s', 'Burgers', ARRAY['McDonalds']),
  ('Burger King', 'Burgers', ARRAY[]::TEXT[]),
  ('Wendy''s', 'Burgers', ARRAY['Wendys']),
  ('Five Guys', 'Burgers', ARRAY['Five Guys Burgers and Fries']),
  ('Shake Shack', 'Burgers', ARRAY[]::TEXT[]),
  ('In-N-Out Burger', 'Burgers', ARRAY['In N Out']),
  ('Whataburger', 'Burgers', ARRAY[]::TEXT[]),
  ('Sonic Drive-In', 'Burgers', ARRAY['Sonic']),
  ('Jack in the Box', 'Burgers', ARRAY[]::TEXT[]),
  ('Carl''s Jr.', 'Burgers', ARRAY['Carls Jr']),
  ('Hardee''s', 'Burgers', ARRAY['Hardees']),
  ('White Castle', 'Burgers', ARRAY[]::TEXT[]),
  ('Culver''s', 'Burgers', ARRAY['Culvers']),
  ('Steak n Shake', 'Burgers', ARRAY['Steak ''n Shake', 'Steak and Shake']),
  ('Smashburger', 'Burgers', ARRAY[]::TEXT[]),
  ('Fatburger', 'Burgers', ARRAY[]::TEXT[]),
  ('Freddy''s Frozen Custard & Steakburgers', 'Burgers', ARRAY['Freddys', 'Freddy''s Frozen Custard and Steakburgers']),
  ('Checkers', 'Burgers', ARRAY['Rally''s', 'Rallys']),
  ('Krystal', 'Burgers', ARRAY[]::TEXT[]),
  ('A&W', 'Burgers', ARRAY['A and W', 'A&W Restaurants']),
  ('Habit Burger Grill', 'Burgers', ARRAY['The Habit Burger Grill', 'Habit Burger & Grill']),
  ('Johnny Rockets', 'Burgers', ARRAY[]::TEXT[]),
  ('BurgerFi', 'Burgers', ARRAY[]::TEXT[]),
  ('Red Robin', 'Burgers', ARRAY['Red Robin Gourmet Burgers and Brews']),
  ('Bobby''s Burger Palace', 'Burgers', ARRAY[]::TEXT[]),
  ('Wayback Burgers', 'Burgers', ARRAY[]::TEXT[]),
  ('Back Yard Burgers', 'Burgers', ARRAY[]::TEXT[]),
  ('Burgerville', 'Burgers', ARRAY[]::TEXT[]),
  -- Chicken
  ('Chick-fil-A', 'Chicken', ARRAY['Chick fil A', 'Chickfila']),
  ('KFC', 'Chicken', ARRAY['Kentucky Fried Chicken']),
  ('Popeyes', 'Chicken', ARRAY['Popeyes Louisiana Kitchen']),
  ('Raising Cane''s', 'Chicken', ARRAY['Raising Canes', 'Raising Cane''s Chicken Fingers']),
  ('Zaxby''s', 'Chicken', ARRAY['Zaxbys']),
  ('Wingstop', 'Chicken', ARRAY[]::TEXT[]),
  ('Buffalo Wild Wings', 'Chicken', ARRAY['BWW', 'B-Dubs']),
  ('Bojangles', 'Chicken', ARRAY['Bojangles'' Famous Chicken ''n Biscuits']),
  ('Church''s Texas Chicken', 'Chicken', ARRAY['Churchs Chicken', 'Church''s Chicken', 'Churchs Texas Chicken']),
  ('El Pollo Loco', 'Chicken', ARRAY[]::TEXT[]),
  ('Pollo Tropical', 'Chicken', ARRAY[]::TEXT[]),
  ('Wings Over', 'Chicken', ARRAY[]::TEXT[]),
  ('Hooters', 'Chicken', ARRAY[]::TEXT[]),
  ('Slim Chickens', 'Chicken', ARRAY[]::TEXT[]),
  ('Dave''s Hot Chicken', 'Chicken', ARRAY['Daves Hot Chicken']),
  ('Golden Chick', 'Chicken', ARRAY[]::TEXT[]),
  ('Mrs Winner''s', 'Chicken', ARRAY['Mrs Winners']),
  ('Pluckers Wing Bar', 'Chicken', ARRAY['Pluckers']),
  ('Bonchon', 'Chicken', ARRAY['Bonchon Chicken']),
  ('Roscoe''s House of Chicken and Waffles', 'Chicken', ARRAY['Roscoes Chicken and Waffles']),
  ('Lee''s Famous Recipe Chicken', 'Chicken', ARRAY['Lees Famous Recipe']),
  ('Pollo Campero', 'Chicken', ARRAY['Campero']),
  -- Pizza
  ('Domino''s Pizza', 'Pizza', ARRAY['Dominos', 'Domino''s', 'Dominos Pizza']),
  ('Pizza Hut', 'Pizza', ARRAY[]::TEXT[]),
  ('Papa John''s', 'Pizza', ARRAY['Papa Johns', 'Papa John''s Pizza']),
  ('Little Caesars', 'Pizza', ARRAY['Little Caesars Pizza']),
  ('Papa Murphy''s', 'Pizza', ARRAY['Papa Murphys', 'Papa Murphy''s Take ''N'' Bake Pizza']),
  ('Marco''s Pizza', 'Pizza', ARRAY['Marcos Pizza']),
  ('Hungry Howie''s', 'Pizza', ARRAY['Hungry Howies', 'Hungry Howie''s Pizza']),
  ('Jet''s Pizza', 'Pizza', ARRAY['Jets Pizza']),
  ('Cici''s Pizza', 'Pizza', ARRAY['Cicis Pizza', 'CiCi''s']),
  ('Round Table Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Godfather''s Pizza', 'Pizza', ARRAY['Godfathers Pizza']),
  ('Donatos Pizza', 'Pizza', ARRAY['Donatos']),
  ('Mod Pizza', 'Pizza', ARRAY['MOD Pizza']),
  ('Blaze Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Pieology', 'Pizza', ARRAY['Pieology Pizzeria']),
  ('Sbarro', 'Pizza', ARRAY[]::TEXT[]),
  ('Chuck E. Cheese', 'Pizza', ARRAY['Chuck E Cheese', 'Chuck E. Cheese''s']),
  ('Uno Pizzeria & Grill', 'Pizza', ARRAY['Uno Pizzeria and Grill', 'Pizzeria Uno']),
  ('Pizza Inn', 'Pizza', ARRAY[]::TEXT[]),
  ('Mellow Mushroom', 'Pizza', ARRAY[]::TEXT[]),
  ('Rosati''s Pizza', 'Pizza', ARRAY['Rosatis Pizza']),
  ('Gatti''s Pizza', 'Pizza', ARRAY['Gattis Pizza']),
  ('Pizza Ranch', 'Pizza', ARRAY[]::TEXT[]),
  ('Peter Piper Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Villa Italian Kitchen', 'Pizza', ARRAY[]::TEXT[]),
  ('Fazoli''s', 'Pizza', ARRAY['Fazolis']),
  -- Sandwiches & subs
  ('Subway', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Jimmy John''s', 'Sandwiches', ARRAY['Jimmy Johns']),
  ('Jersey Mike''s Subs', 'Sandwiches', ARRAY['Jersey Mikes', 'Jersey Mike''s']),
  ('Firehouse Subs', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Potbelly Sandwich Shop', 'Sandwiches', ARRAY['Potbelly']),
  ('Arby''s', 'Sandwiches', ARRAY['Arbys']),
  ('Quiznos', 'Sandwiches', ARRAY['Quizno''s']),
  ('Schlotzsky''s', 'Sandwiches', ARRAY['Schlotzskys']),
  ('Which Wich', 'Sandwiches', ARRAY['Which Wich Superior Sandwiches']),
  ('Capriotti''s Sandwich Shop', 'Sandwiches', ARRAY['Capriottis']),
  ('Penn Station East Coast Subs', 'Sandwiches', ARRAY['Penn Station']),
  ('McAlister''s Deli', 'Sandwiches', ARRAY['McAlisters Deli']),
  ('Jason''s Deli', 'Sandwiches', ARRAY['Jasons Deli']),
  ('Blimpie', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Charleys Philly Steaks', 'Sandwiches', ARRAY['Charley''s Philly Steaks', 'Charleys Cheesesteaks']),
  ('Wawa', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Sheetz', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Port of Subs', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Togo''s', 'Sandwiches', ARRAY['Togos', 'Togo''s Sandwiches']),
  ('Erbert & Gerbert''s', 'Sandwiches', ARRAY['Erbert and Gerberts']),
  ('Cousins Subs', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Primo Hoagies', 'Sandwiches', ARRAY[]::TEXT[]),
  ('Lenny''s Sub Shop', 'Sandwiches', ARRAY['Lennys Sub Shop', 'Lenny''s Subs']),
  ('Panera Bread', 'Sandwiches', ARRAY['Panera']),
  ('Corner Bakery Cafe', 'Sandwiches', ARRAY['Corner Bakery']),
  ('Einstein Bros. Bagels', 'Breakfast', ARRAY['Einstein Bros Bagels', 'Einstein Bagels']),
  ('Bruegger''s', 'Breakfast', ARRAY['Brueggers', 'Bruegger''s Bagels']),
  ('Noah''s New York Bagels', 'Breakfast', ARRAY['Noahs Bagels']),
  ('Big Apple Bagels', 'Breakfast', ARRAY[]::TEXT[]),
  ('Manhattan Bagel', 'Breakfast', ARRAY[]::TEXT[]),
  -- Mexican & Tex-Mex
  ('Taco Bell', 'Mexican', ARRAY[]::TEXT[]),
  ('Chipotle Mexican Grill', 'Mexican', ARRAY['Chipotle']),
  ('Qdoba Mexican Eats', 'Mexican', ARRAY['Qdoba', 'Qdoba Mexican Grill']),
  ('Moe''s Southwest Grill', 'Mexican', ARRAY['Moes Southwest Grill', 'Moe''s']),
  ('Del Taco', 'Mexican', ARRAY[]::TEXT[]),
  ('Taco Bueno', 'Mexican', ARRAY[]::TEXT[]),
  ('Taco John''s', 'Mexican', ARRAY['Taco Johns']),
  ('Taco Cabana', 'Mexican', ARRAY[]::TEXT[]),
  ('Baja Fresh', 'Mexican', ARRAY['Baja Fresh Mexican Grill']),
  ('Rubio''s Coastal Grill', 'Mexican', ARRAY['Rubios', 'Rubio''s Fresh Mexican Grill']),
  ('Chuy''s', 'Mexican', ARRAY['Chuys', 'Chuy''s Tex-Mex']),
  ('On The Border', 'Mexican', ARRAY['On The Border Mexican Grill and Cantina']),
  ('Chevys Fresh Mex', 'Mexican', ARRAY['Chevys']),
  ('Don Pablo''s', 'Mexican', ARRAY['Don Pablos']),
  ('El Torito', 'Mexican', ARRAY[]::TEXT[]),
  ('Abuelo''s Mexican Restaurant', 'Mexican', ARRAY['Abuelos']),
  ('Margaritas Mexican Restaurant', 'Mexican', ARRAY['Margaritas']),
  ('Tijuana Flats', 'Mexican', ARRAY[]::TEXT[]),
  ('Costa Vida', 'Mexican', ARRAY['Costa Vida Fresh Mexican Grill']),
  ('Cafe Rio', 'Mexican', ARRAY['Cafe Rio Mexican Grill']),
  ('Willy''s Mexicana Grill', 'Mexican', ARRAY['Willys Mexicana Grill']),
  ('Salsarita''s', 'Mexican', ARRAY['Salsaritas', 'Salsarita''s Fresh Mexican Grill']),
  ('Pancheros Mexican Grill', 'Mexican', ARRAY['Pancheros']),
  ('Z''Tejas', 'Mexican', ARRAY['ZTejas']),
  ('Torchy''s Tacos', 'Mexican', ARRAY['Torchys Tacos']),
  ('Velvet Taco', 'Mexican', ARRAY[]::TEXT[]),
  ('Rosa''s Cafe', 'Mexican', ARRAY['Rosas Cafe', 'Rosa''s Cafe & Tortilla Factory']),
  ('Fuzzy''s Taco Shop', 'Mexican', ARRAY['Fuzzys Taco Shop']),
  ('Bar Louie', 'Bar & Grill', ARRAY[]::TEXT[]),
  -- Asian
  ('Panda Express', 'Asian', ARRAY[]::TEXT[]),
  ('P.F. Chang''s', 'Asian', ARRAY['PF Changs', 'P F Chang''s China Bistro', 'PF Chang''s']),
  ('Pei Wei Asian Kitchen', 'Asian', ARRAY['Pei Wei']),
  ('Benihana', 'Asian', ARRAY[]::TEXT[]),
  ('Teriyaki Madness', 'Asian', ARRAY[]::TEXT[]),
  ('Yoshinoya', 'Asian', ARRAY[]::TEXT[]),
  ('Manchu Wok', 'Asian', ARRAY[]::TEXT[]),
  ('Sarku Japan', 'Asian', ARRAY[]::TEXT[]),
  ('Hibachi-San', 'Asian', ARRAY['Hibachi San']),
  ('Genghis Grill', 'Asian', ARRAY[]::TEXT[]),
  ('BD''s Mongolian Grill', 'Asian', ARRAY['BDs Mongolian Grill']),
  ('HuHot Mongolian Grill', 'Asian', ARRAY['HuHot']),
  ('Pho Hoa', 'Asian', ARRAY[]::TEXT[]),
  ('Kung Fu Tea', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Kura Sushi', 'Asian', ARRAY['Kura Revolving Sushi Bar']),
  ('Tokyo Joe''s', 'Asian', ARRAY['Tokyo Joes']),
  ('Yoshiharu Ramen', 'Asian', ARRAY[]::TEXT[]),
  ('Tropical Smoothie Cafe', 'Healthy', ARRAY['Tropical Smoothie']),
  ('Noodles & Company', 'Asian', ARRAY['Noodles and Company', 'Noodles & Co']),
  -- Coffee & tea
  ('Starbucks', 'Coffee & Tea', ARRAY['Starbucks Coffee']),
  ('Dunkin''', 'Coffee & Tea', ARRAY['Dunkin', 'Dunkin Donuts', 'Dunkin'' Donuts']),
  ('Tim Hortons', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Peet''s Coffee', 'Coffee & Tea', ARRAY['Peets Coffee', 'Peet''s Coffee & Tea']),
  ('Caribou Coffee', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('The Coffee Bean & Tea Leaf', 'Coffee & Tea', ARRAY['Coffee Bean and Tea Leaf', 'Coffee Bean & Tea Leaf']),
  ('Dutch Bros Coffee', 'Coffee & Tea', ARRAY['Dutch Bros', 'Dutch Brothers']),
  ('Scooter''s Coffee', 'Coffee & Tea', ARRAY['Scooters Coffee']),
  ('Biggby Coffee', 'Coffee & Tea', ARRAY['Biggby']),
  ('Black Rifle Coffee Company', 'Coffee & Tea', ARRAY['Black Rifle Coffee']),
  ('7 Brew Coffee', 'Coffee & Tea', ARRAY['7 Brew']),
  ('Gloria Jean''s Coffees', 'Coffee & Tea', ARRAY['Gloria Jeans']),
  ('Tully''s Coffee', 'Coffee & Tea', ARRAY['Tullys Coffee']),
  ('Ziggi''s Coffee', 'Coffee & Tea', ARRAY['Ziggis Coffee']),
  ('Gong Cha', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Sharetea', 'Coffee & Tea', ARRAY['Share Tea']),
  ('Teavana', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Philz Coffee', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Blue Bottle Coffee', 'Coffee & Tea', ARRAY[]::TEXT[]),
  ('Krispy Kreme', 'Bakery & Dessert', ARRAY['Krispy Kreme Doughnuts']),
  ('Jamba', 'Healthy', ARRAY['Jamba Juice']),
  ('Smoothie King', 'Healthy', ARRAY[]::TEXT[]),
  ('Robeks', 'Healthy', ARRAY['Robeks Fresh Juices and Smoothies']),
  ('Planet Smoothie', 'Healthy', ARRAY[]::TEXT[]),
  ('Clean Juice', 'Healthy', ARRAY[]::TEXT[]),
  ('Playa Bowls', 'Healthy', ARRAY[]::TEXT[]),
  ('Nekter Juice Bar', 'Healthy', ARRAY['Nekter']),
  ('Juice It Up', 'Healthy', ARRAY[]::TEXT[]),
  ('Maui Wowi', 'Healthy', ARRAY['Maui Wowi Hawaiian Coffees and Smoothies']),
  -- Bakery & dessert
  ('Dairy Queen', 'Bakery & Dessert', ARRAY['DQ', 'DQ Grill & Chill', 'Dairy Queen Grill & Chill']),
  ('Baskin-Robbins', 'Bakery & Dessert', ARRAY['Baskin Robbins']),
  ('Ben & Jerry''s', 'Bakery & Dessert', ARRAY['Ben and Jerrys']),
  ('Cold Stone Creamery', 'Bakery & Dessert', ARRAY['Cold Stone']),
  ('Carvel', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Marble Slab Creamery', 'Bakery & Dessert', ARRAY['Marble Slab']),
  ('Rita''s Italian Ice', 'Bakery & Dessert', ARRAY['Ritas Italian Ice', 'Rita''s']),
  ('Menchie''s', 'Bakery & Dessert', ARRAY['Menchies', 'Menchie''s Frozen Yogurt']),
  ('Yogurtland', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Pinkberry', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Sweet Frog', 'Bakery & Dessert', ARRAY['Sweetfrog', 'Sweet Frog Premium Frozen Yogurt']),
  ('TCBY', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Orange Julius', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Insomnia Cookies', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Crumbl Cookies', 'Bakery & Dessert', ARRAY['Crumbl']),
  ('Nothing Bundt Cakes', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Great American Cookies', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Mrs. Fields', 'Bakery & Dessert', ARRAY['Mrs Fields', 'Mrs. Fields Cookies']),
  ('Auntie Anne''s', 'Bakery & Dessert', ARRAY['Auntie Annes']),
  ('Cinnabon', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Wetzel''s Pretzels', 'Bakery & Dessert', ARRAY['Wetzels Pretzels']),
  ('Pretzelmaker', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Shipley Do-Nuts', 'Bakery & Dessert', ARRAY['Shipley Donuts', 'Shipley Do Nuts']),
  ('Duck Donuts', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Voodoo Doughnut', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Sprinkles Cupcakes', 'Bakery & Dessert', ARRAY['Sprinkles']),
  ('Baked by Melissa', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Bruster''s Real Ice Cream', 'Bakery & Dessert', ARRAY['Brusters Ice Cream', 'Brusters']),
  ('Andy''s Frozen Custard', 'Bakery & Dessert', ARRAY['Andys Frozen Custard']),
  ('Bahama Buck''s', 'Bakery & Dessert', ARRAY['Bahama Bucks']),
  ('Kona Ice', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Handel''s Homemade Ice Cream', 'Bakery & Dessert', ARRAY['Handels Ice Cream']),
  ('Graeter''s Ice Cream', 'Bakery & Dessert', ARRAY['Graeters']),
  ('Jeni''s Splendid Ice Creams', 'Bakery & Dessert', ARRAY['Jenis Ice Cream', 'Jeni''s']),
  ('Haagen-Dazs', 'Bakery & Dessert', ARRAY['Haagen Dazs', 'Häagen-Dazs']),
  ('Dippin'' Dots', 'Bakery & Dessert', ARRAY['Dippin Dots']),
  ('Paris Baguette', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Tous les Jours', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Le Pain Quotidien', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Au Bon Pain', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('La Madeleine', 'Bakery & Dessert', ARRAY['La Madeleine French Bakery & Cafe']),
  ('Perkins', 'Family Dining', ARRAY['Perkins Restaurant & Bakery', 'Perkins Restaurant and Bakery']),
  -- Fast casual & healthy
  ('Sweetgreen', 'Healthy', ARRAY[]::TEXT[]),
  ('Cava', 'Healthy', ARRAY['Cava Mezze Grill']),
  ('Chopt', 'Healthy', ARRAY['Chopt Creative Salad Co']),
  ('Salad and Go', 'Healthy', ARRAY['Salad & Go']),
  ('Freshii', 'Healthy', ARRAY[]::TEXT[]),
  ('Zoe''s Kitchen', 'Healthy', ARRAY['Zoes Kitchen']),
  ('Modern Market Eatery', 'Healthy', ARRAY['Modern Market']),
  ('Mad Greens', 'Healthy', ARRAY['Mad Greens Eat Good']),
  ('Saladworks', 'Healthy', ARRAY[]::TEXT[]),
  ('Souplantation', 'Healthy', ARRAY['Sweet Tomatoes']),
  ('Veggie Grill', 'Healthy', ARRAY[]::TEXT[]),
  ('Native Foods Cafe', 'Healthy', ARRAY[]::TEXT[]),
  ('Flower Child', 'Healthy', ARRAY[]::TEXT[]),
  ('True Food Kitchen', 'Healthy', ARRAY[]::TEXT[]),
  ('Pret A Manger', 'Healthy', ARRAY['Pret']),
  ('Tender Greens', 'Healthy', ARRAY[]::TEXT[]),
  ('Lyfe Kitchen', 'Healthy', ARRAY[]::TEXT[]),
  ('Hot Dog on a Stick', 'Fast Food', ARRAY[]::TEXT[]),
  ('Nathan''s Famous', 'Fast Food', ARRAY['Nathans Famous', 'Nathan''s Hot Dogs']),
  ('Portillo''s', 'Fast Food', ARRAY['Portillos']),
  ('Wienerschnitzel', 'Fast Food', ARRAY[]::TEXT[]),
  ('Long John Silver''s', 'Seafood', ARRAY['Long John Silvers']),
  ('Captain D''s', 'Seafood', ARRAY['Captain Ds', 'Captain D''s Seafood Kitchen']),
  ('Arthur Treacher''s', 'Seafood', ARRAY['Arthur Treachers']),
  ('Skippers Seafood', 'Seafood', ARRAY['Skipper''s Seafood & Chowder']),
  ('Del Frisco''s', 'Steakhouse', ARRAY['Del Friscos', 'Del Frisco''s Double Eagle Steakhouse']),
  -- Casual & family dining
  ('Applebee''s', 'Casual Dining', ARRAY['Applebees', 'Applebee''s Grill + Bar', 'Applebees Grill and Bar']),
  ('Chili''s', 'Casual Dining', ARRAY['Chilis', 'Chili''s Grill & Bar', 'Chilis Grill and Bar']),
  ('Olive Garden', 'Casual Dining', ARRAY['Olive Garden Italian Restaurant']),
  ('Outback Steakhouse', 'Steakhouse', ARRAY['Outback']),
  ('Red Lobster', 'Seafood', ARRAY[]::TEXT[]),
  ('TGI Fridays', 'Casual Dining', ARRAY['TGI Friday''s', 'Fridays']),
  ('Ruby Tuesday', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Texas Roadhouse', 'Steakhouse', ARRAY[]::TEXT[]),
  ('LongHorn Steakhouse', 'Steakhouse', ARRAY['Longhorn Steakhouse', 'Long Horn Steakhouse']),
  ('Cheesecake Factory', 'Casual Dining', ARRAY['The Cheesecake Factory']),
  ('Cracker Barrel', 'Family Dining', ARRAY['Cracker Barrel Old Country Store']),
  ('Denny''s', 'Family Dining', ARRAY['Dennys']),
  ('IHOP', 'Breakfast', ARRAY['International House of Pancakes']),
  ('Waffle House', 'Breakfast', ARRAY[]::TEXT[]),
  ('Bob Evans', 'Family Dining', ARRAY['Bob Evans Restaurants']),
  ('Golden Corral', 'Family Dining', ARRAY[]::TEXT[]),
  ('Shoney''s', 'Family Dining', ARRAY['Shoneys']),
  ('Friendly''s', 'Family Dining', ARRAY['Friendlys']),
  ('Big Boy', 'Family Dining', ARRAY['Bob''s Big Boy', 'Frisch''s Big Boy']),
  ('Village Inn', 'Family Dining', ARRAY[]::TEXT[]),
  ('Huddle House', 'Breakfast', ARRAY[]::TEXT[]),
  ('First Watch', 'Breakfast', ARRAY['First Watch Daytime Cafe']),
  ('Another Broken Egg Cafe', 'Breakfast', ARRAY['Another Broken Egg']),
  ('Snooze An A.M. Eatery', 'Breakfast', ARRAY['Snooze', 'Snooze AM Eatery']),
  ('Original Pancake House', 'Breakfast', ARRAY['The Original Pancake House']),
  ('Black Bear Diner', 'Family Dining', ARRAY[]::TEXT[]),
  ('Sonny''s BBQ', 'BBQ', ARRAY['Sonnys BBQ', 'Sonny''s Real Pit Bar-B-Q']),
  ('Famous Dave''s', 'BBQ', ARRAY['Famous Daves', 'Famous Dave''s BBQ']),
  ('Dickey''s Barbecue Pit', 'BBQ', ARRAY['Dickeys Barbecue Pit', 'Dickey''s BBQ']),
  ('Smokey Bones', 'BBQ', ARRAY['Smokey Bones Bar & Fire Grill']),
  ('Rudy''s Country Store and Bar-B-Q', 'BBQ', ARRAY['Rudys BBQ', 'Rudy''s BBQ']),
  ('Jim ''N Nick''s Bar-B-Q', 'BBQ', ARRAY['Jim N Nicks', 'Jim ''N Nick''s']),
  ('Dreamland Bar-B-Que', 'BBQ', ARRAY['Dreamland BBQ']),
  ('Bonefish Grill', 'Seafood', ARRAY[]::TEXT[]),
  ('Carrabba''s Italian Grill', 'Casual Dining', ARRAY['Carrabbas', 'Carrabba''s']),
  ('Maggiano''s Little Italy', 'Casual Dining', ARRAY['Maggianos']),
  ('Romano''s Macaroni Grill', 'Casual Dining', ARRAY['Macaroni Grill', 'Romanos Macaroni Grill']),
  ('Buca di Beppo', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Bertucci''s', 'Casual Dining', ARRAY['Bertuccis']),
  ('Brio Italian Grille', 'Casual Dining', ARRAY['Brio Tuscan Grille']),
  ('Bravo Italian Kitchen', 'Casual Dining', ARRAY['Bravo Brio']),
  ('Biaggi''s Ristorante Italiano', 'Casual Dining', ARRAY['Biaggis']),
  ('Yard House', 'Bar & Grill', ARRAY[]::TEXT[]),
  ('BJ''s Restaurant & Brewhouse', 'Bar & Grill', ARRAY['BJs Restaurant and Brewhouse', 'BJ''s Brewhouse']),
  ('Twin Peaks', 'Bar & Grill', ARRAY[]::TEXT[]),
  ('Miller''s Ale House', 'Bar & Grill', ARRAY['Millers Ale House']),
  ('O''Charley''s', 'Casual Dining', ARRAY['OCharleys', 'O''Charley''s Restaurant & Bar']),
  ('Logan''s Roadhouse', 'Steakhouse', ARRAY['Logans Roadhouse']),
  ('Lone Star Steakhouse', 'Steakhouse', ARRAY['Lone Star Steakhouse & Saloon']),
  ('Saltgrass Steak House', 'Steakhouse', ARRAY['Saltgrass']),
  ('Ruth''s Chris Steak House', 'Steakhouse', ARRAY['Ruths Chris', 'Ruth''s Chris']),
  ('Morton''s The Steakhouse', 'Steakhouse', ARRAY['Mortons', 'Morton''s Steakhouse']),
  ('The Capital Grille', 'Steakhouse', ARRAY['Capital Grille']),
  ('Fleming''s Prime Steakhouse & Wine Bar', 'Steakhouse', ARRAY['Flemings Prime Steakhouse', 'Fleming''s']),
  ('Smith & Wollensky', 'Steakhouse', ARRAY['Smith and Wollensky']),
  ('Chart House', 'Steakhouse', ARRAY[]::TEXT[]),
  ('Joe''s Crab Shack', 'Seafood', ARRAY['Joes Crab Shack']),
  ('Landry''s Seafood House', 'Seafood', ARRAY['Landrys Seafood']),
  ('Bubba Gump Shrimp Co.', 'Seafood', ARRAY['Bubba Gump Shrimp Company', 'Bubba Gump']),
  ('Legal Sea Foods', 'Seafood', ARRAY[]::TEXT[]),
  ('Dave & Buster''s', 'Bar & Grill', ARRAY['Dave and Busters', 'Dave & Busters']),
  ('Main Event', 'Bar & Grill', ARRAY[]::TEXT[]),
  ('Topgolf', 'Bar & Grill', ARRAY[]::TEXT[]),
  ('Hard Rock Cafe', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Rainforest Cafe', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Planet Hollywood', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Cheddar''s Scratch Kitchen', 'Casual Dining', ARRAY['Cheddars', 'Cheddar''s']),
  ('Houlihan''s', 'Casual Dining', ARRAY['Houlihans']),
  ('Claim Jumper', 'Casual Dining', ARRAY[]::TEXT[]),
  ('Marie Callender''s', 'Family Dining', ARRAY['Marie Callenders']),
  ('Coco''s Bakery Restaurant', 'Family Dining', ARRAY['Cocos Bakery', 'Coco''s']),
  ('Carrows', 'Family Dining', ARRAY['Carrows Restaurant']),
  ('Biscuitville', 'Breakfast', ARRAY[]::TEXT[]),
  ('Eat''n Park', 'Family Dining', ARRAY['Eat n Park']),
  ('Mimi''s Cafe', 'Family Dining', ARRAY['Mimis Cafe']),
  ('Red Mango', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  -- Convenience / grocery food counters
  ('7-Eleven', 'Convenience', ARRAY['7 Eleven', 'Seven Eleven']),
  ('Circle K', 'Convenience', ARRAY[]::TEXT[]),
  ('Casey''s', 'Convenience', ARRAY['Caseys', 'Casey''s General Store']),
  ('QuikTrip', 'Convenience', ARRAY['QT', 'Quik Trip']),
  ('Buc-ee''s', 'Convenience', ARRAY['Bucees', 'Buc ees']),
  ('Love''s Travel Stops', 'Convenience', ARRAY['Loves Travel Stop', 'Love''s']),
  ('Pilot Flying J', 'Convenience', ARRAY['Flying J', 'Pilot Travel Center']),
  ('Maverik', 'Convenience', ARRAY[]::TEXT[]),
  ('RaceTrac', 'Convenience', ARRAY['Race Trac']),
  ('Kwik Trip', 'Convenience', ARRAY['Kwik Star']),
  ('Speedway', 'Convenience', ARRAY[]::TEXT[]),
  ('Whole Foods Market', 'Convenience', ARRAY['Whole Foods']),
  ('Trader Joe''s', 'Convenience', ARRAY['Trader Joes']),
  -- Other fast food
  ('Jollibee', 'Chicken', ARRAY[]::TEXT[]),
  ('Lazy Dog Restaurant & Bar', 'Casual Dining', ARRAY['Lazy Dog']),
  ('Black Angus Steakhouse', 'Steakhouse', ARRAY['Black Angus']),
  ('Hot Head Burritos', 'Mexican', ARRAY[]::TEXT[]),
  ('Burrito Beach', 'Mexican', ARRAY[]::TEXT[]),
  ('Boston Market', 'Fast Casual', ARRAY[]::TEXT[]),
  ('Kenny Rogers Roasters', 'Chicken', ARRAY[]::TEXT[]),
  ('Luby''s', 'Family Dining', ARRAY['Lubys']),
  ('Piccadilly', 'Family Dining', ARRAY['Piccadilly Cafeteria']),
  ('Furr''s', 'Family Dining', ARRAY['Furrs', 'Furr''s Fresh Buffet']),
  ('Ryan''s', 'Family Dining', ARRAY['Ryans']),
  ('Sizzler', 'Steakhouse', ARRAY[]::TEXT[]),
  ('Ponderosa Steakhouse', 'Steakhouse', ARRAY['Ponderosa']),
  ('Bonanza Steakhouse', 'Steakhouse', ARRAY['Bonanza']),
  ('Western Sizzlin', 'Steakhouse', ARRAY['Western Sizzlin Steakhouse']),
  ('Roti Modern Mediterranean', 'Mediterranean', ARRAY['Roti']),
  ('Pita Pit', 'Mediterranean', ARRAY[]::TEXT[]),
  ('Taziki''s Mediterranean Cafe', 'Mediterranean', ARRAY['Tazikis Mediterranean Cafe', 'Taziki''s']),
  ('The Halal Guys', 'Mediterranean', ARRAY['Halal Guys']),
  ('Garbanzo Mediterranean Fresh', 'Mediterranean', ARRAY['Garbanzo']),
  ('Naf Naf Grill', 'Mediterranean', ARRAY[]::TEXT[]),
  ('Philly Pretzel Factory', 'Bakery & Dessert', ARRAY[]::TEXT[]),
  ('Papa Gino''s', 'Pizza', ARRAY['Papa Ginos']),
  ('Ledo Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Fox''s Pizza Den', 'Pizza', ARRAY['Foxs Pizza Den']),
  ('Toppers Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Pizza Patron', 'Pizza', ARRAY[]::TEXT[]),
  ('Straw Hat Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Vocelli Pizza', 'Pizza', ARRAY[]::TEXT[]),
  ('Nick-N-Willy''s', 'Pizza', ARRAY['Nick N Willys']),
  ('Mountain Mike''s Pizza', 'Pizza', ARRAY['Mountain Mikes Pizza']),
  ('Pizza Studio', 'Pizza', ARRAY[]::TEXT[]),
  ('Your Pie', 'Pizza', ARRAY[]::TEXT[])
) AS v(name, category, aliases)
ON CONFLICT (normalized_name) DO NOTHING;
