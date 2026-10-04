-- Admin reports showing how the franchise list (062) classifies the customer
-- restaurant cache: one lists cached restaurants that match a franchise, the
-- other lists those that don't. Uses the same matching rule as
-- is_franchise_chain() — normalized exact match against the franchise name or
-- one of its aliases, active entries only — so the reports show exactly what
-- the consumer app treats as a chain. Same admin-gated, read-only RPC pattern
-- as migrations 045/046.

-- ── 1. Cached restaurants that match a franchise ────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_franchise_restaurants()
RETURNS TABLE (
  place_id TEXT,
  restaurant_name TEXT,
  address TEXT,
  city TEXT,
  matched_franchise TEXT,
  franchise_category TEXT,
  cached_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    cr.place_id,
    cr.name,
    cr.address,
    cr.city,
    m.name,
    m.category,
    cr.cached_at
  FROM public.cached_restaurants cr
  JOIN LATERAL (
    SELECT fc.name, fc.category
    FROM public.franchise_chains fc
    WHERE fc.is_active
      AND (
        fc.normalized_name = public.normalize_restaurant_name(cr.name)
        OR EXISTS (
          SELECT 1 FROM unnest(fc.aliases) a
          WHERE public.normalize_restaurant_name(a) = public.normalize_restaurant_name(cr.name)
        )
      )
    ORDER BY fc.name
    LIMIT 1
  ) m ON true
  WHERE public.normalize_restaurant_name(cr.name) <> ''
  ORDER BY cr.name, cr.city;
END;
$$;

-- ── 2. Cached restaurants that do NOT match any franchise ───────────────────
CREATE OR REPLACE FUNCTION public.admin_report_non_franchise_restaurants()
RETURNS TABLE (
  place_id TEXT,
  restaurant_name TEXT,
  address TEXT,
  city TEXT,
  cuisine_types TEXT[],
  cached_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public._require_admin();

  RETURN QUERY
  SELECT
    cr.place_id,
    cr.name,
    cr.address,
    cr.city,
    cr.cuisine_types,
    cr.cached_at
  FROM public.cached_restaurants cr
  WHERE NOT public.is_franchise_chain(cr.name)
  ORDER BY cr.name, cr.city;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_report_franchise_restaurants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report_non_franchise_restaurants() TO authenticated;
