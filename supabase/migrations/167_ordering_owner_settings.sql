-- Pickup ordering, stage 3: the owner sets the restaurant's timezone and its prep time.
--
--   owner_update_ordering_settings(restaurant, prep_minutes, timezone)
--       owner only. A NULL argument leaves that setting as it is. The prep time must be 5-240 minutes. The timezone must be a name the
--       database knows (America/Chicago, not "Central"): it decides when a day ends for the staff link and for same-day pickup times.
--
-- A function rather than a direct update, so a typo cannot store a timezone that later breaks the staff link. (The owner's switch and
-- prices already have their functions, from migration 165.)
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.owner_update_ordering_settings(
  p_restaurant_id UUID,
  p_prep_minutes  INTEGER DEFAULT NULL,
  p_timezone      TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_tz    TEXT := NULLIF(btrim(COALESCE(p_timezone, '')), '');
BEGIN
  SELECT r.owner_id INTO v_owner FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to manage this restaurant';
  END IF;

  IF p_prep_minutes IS NOT NULL AND (p_prep_minutes < 5 OR p_prep_minutes > 240) THEN
    RAISE EXCEPTION 'The prep time must be between 5 and 240 minutes';
  END IF;

  -- a timezone that was given but is blank or unknown is refused (not silently ignored)
  IF p_timezone IS NOT NULL AND (v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_tz)) THEN
    RAISE EXCEPTION 'That timezone is not recognised. Use a name like America/Chicago';
  END IF;

  UPDATE public.restaurants r
     SET ordering_prep_minutes = COALESCE(p_prep_minutes, r.ordering_prep_minutes),
         timezone = COALESCE(v_tz, r.timezone),
         updated_at = NOW()
   WHERE r.id = p_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_update_ordering_settings(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_ordering_settings(UUID, INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
