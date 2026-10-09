-- Fix for migration 129: the check that runs when a restaurant's categories are saved reads restaurant_categories, a table that
-- signed-in users cannot read directly. Because the check ran with the owner's own rights, an owner saving "About your place" (or
-- claiming a restaurant) got "permission denied for table restaurant_categories". It now runs with the function owner's rights, like
-- the other functions around it. Same rules as before. Safe to re-run.

CREATE OR REPLACE FUNCTION public._check_restaurant_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bad TEXT;
BEGIN
  IF NEW.venue_types IS NOT NULL THEN
    IF cardinality(NEW.venue_types) = 0 THEN RAISE EXCEPTION 'Choose at least one place type'; END IF;
    SELECT k INTO v_bad FROM unnest(NEW.venue_types) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'venue') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown place type: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.venue_types) k) <> cardinality(NEW.venue_types) THEN
      RAISE EXCEPTION 'A place type is listed twice';
    END IF;
  END IF;
  IF NEW.services IS NOT NULL THEN
    SELECT k INTO v_bad FROM unnest(NEW.services) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'service') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown way to order: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.services) k) <> cardinality(NEW.services) THEN
      RAISE EXCEPTION 'A way to order is listed twice';
    END IF;
  END IF;
  IF NEW.cuisines IS NOT NULL THEN
    SELECT k INTO v_bad FROM unnest(NEW.cuisines) k
      WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_categories c WHERE c.key = k AND c.grp = 'cuisine') LIMIT 1;
    IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown cuisine: %', v_bad; END IF;
    IF (SELECT COUNT(DISTINCT k) FROM unnest(NEW.cuisines) k) <> cardinality(NEW.cuisines) THEN
      RAISE EXCEPTION 'A cuisine is listed twice';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._check_restaurant_categories() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
