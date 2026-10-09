-- Admin: add a franchise chain to the Franchise Lookup list (franchise_chains), from the
-- Franchise Menu Management page.
--
-- Matching in the app is an exact match on the normalized name or an alias (see
-- normalize_restaurant_name, migration 062), so this refuses a chain whose name or any alias
-- is already used by an existing chain (active or not), with a message naming it. The
-- normalized name is filled in by the table's own trigger.
--
-- Inputs: name (required, 120 chars max), category (optional), aliases (optional, up to 20,
-- each 120 chars max), built-in menu page (optional, same address rule as migration 085).
-- Returns the new chain's id. SECURITY DEFINER + _require_admin(), signed-in users only
-- (the admin check is inside), never anon. Safe to re-run.
CREATE OR REPLACE FUNCTION public.admin_add_franchise_chain(
  p_name     TEXT,
  p_category TEXT DEFAULT NULL,
  p_aliases  TEXT[] DEFAULT '{}',
  p_menu_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name      TEXT := btrim(COALESCE(p_name, ''));
  v_category  TEXT := NULLIF(btrim(COALESCE(p_category, '')), '');
  v_url       TEXT := NULLIF(btrim(COALESCE(p_menu_url, '')), '');
  v_norm      TEXT;
  v_aliases   TEXT[];
  v_norms     TEXT[];
  v_clash     TEXT;
  v_id        UUID;
BEGIN
  PERFORM public._require_admin();

  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Enter the franchise name (up to 120 characters)';
  END IF;
  v_norm := public.normalize_restaurant_name(v_name);
  IF v_norm = '' THEN
    RAISE EXCEPTION 'The franchise name must contain letters or numbers';
  END IF;
  IF v_category IS NOT NULL AND length(v_category) > 60 THEN
    RAISE EXCEPTION 'The category is too long (60 characters at most)';
  END IF;
  IF v_url IS NOT NULL AND (length(v_url) > 2000 OR v_url ~ '\s' OR v_url !~* '^https?://[^/?#\s]+\.[^/?#\s]+') THEN
    RAISE EXCEPTION 'The menu page must be a full web address starting with http:// or https://';
  END IF;

  -- Aliases: trimmed, no blanks, no repeats, none that normalize to the name itself.
  SELECT COALESCE(array_agg(DISTINCT btrim(a)), '{}') INTO v_aliases
  FROM unnest(COALESCE(p_aliases, '{}')) AS a
  WHERE btrim(a) <> '' AND public.normalize_restaurant_name(a) <> '' AND public.normalize_restaurant_name(a) <> v_norm;
  IF cardinality(v_aliases) > 20 THEN
    RAISE EXCEPTION 'Too many aliases (20 at most)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_aliases) a WHERE length(a) > 120) THEN
    RAISE EXCEPTION 'An alias is too long (120 characters at most)';
  END IF;

  SELECT array_agg(DISTINCT public.normalize_restaurant_name(a)) INTO v_norms FROM unnest(v_aliases) a;
  v_norms := COALESCE(v_norms, '{}') || v_norm;

  SELECT fc.name INTO v_clash
  FROM public.franchise_chains fc
  WHERE fc.normalized_name = ANY (v_norms)
     OR EXISTS (SELECT 1 FROM unnest(fc.aliases) x WHERE public.normalize_restaurant_name(x) = ANY (v_norms))
  ORDER BY fc.name
  LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'This name or one of its aliases is already used by "%" on the franchise list', v_clash;
  END IF;

  INSERT INTO public.franchise_chains (name, category, aliases, menu_url)
  VALUES (v_name, v_category, v_aliases, v_url)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_franchise_chain(TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_franchise_chain(TEXT, TEXT, TEXT[], TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
