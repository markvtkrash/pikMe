-- In-app announcements: an admin writes a message, and the customer app or the owner site shows it once, the next time it is
-- opened.
--
--   announcements                the messages: who they are for (customer / owner / both), title, text, type (info, or important =
--                                must be acknowledged), an optional link, a start and end time, and an optional app version
--                                range (customers). Nobody reads or writes the table directly; everything goes through the
--                                functions below.
--   _version_cmp(a, b)           compares two versions such as 1.2.0 and 1.10.0 (-1, 0 or 1).
--   get_active_announcements(audience, app_version)
--                                the live announcements for 'customer' or 'owner' (and 'both'), most important first, at most 3.
--                                Readable before sign-in. The version range applies only when a version is given.
--   get_customer_config(app_version)
--                                replaces migration 127's call with the same settings PLUS the live announcements, so the
--                                customer app still makes ONE request. Same whitelist of settings; nothing else is exposed.
--   admin_list_announcements / admin_save_announcement / admin_end_announcement / admin_delete_announcement
--                                the admin page (Tools -> Announcements). Admin only.
--
-- Backward compatible: the customer app can be on phones that never update. The settings in get_customer_config keep their
-- names, and an app that does not know about announcements simply ignores the extra field. Safe to re-run.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience        TEXT NOT NULL CHECK (audience IN ('customer', 'owner', 'both')),
  title           TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  message         TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 600),
  kind            TEXT NOT NULL DEFAULT 'info' CHECK (kind IN ('info', 'important')),
  link_label      TEXT CHECK (link_label IS NULL OR char_length(btrim(link_label)) BETWEEN 1 AND 40),
  link_url        TEXT CHECK (link_url IS NULL OR (link_url ~* '^https://[^[:space:]]{4,}$' AND char_length(link_url) <= 2000)),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  min_app_version TEXT CHECK (min_app_version IS NULL OR min_app_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  max_app_version TEXT CHECK (max_app_version IS NULL OR max_app_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT announcements_link_both CHECK ((link_label IS NULL) = (link_url IS NULL)),
  CONSTRAINT announcements_ends_after_start CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_live ON public.announcements (starts_at, ends_at);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcements FROM PUBLIC, anon, authenticated;

-- ── 2. Version comparison ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._version_cmp(a TEXT, b TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i INTEGER;
  x INTEGER;
  y INTEGER;
BEGIN
  FOR i IN 1..3 LOOP
    x := COALESCE(NULLIF(regexp_replace(split_part(COALESCE(a, ''), '.', i), '[^0-9].*$', ''), '')::INTEGER, 0);
    y := COALESCE(NULLIF(regexp_replace(split_part(COALESCE(b, ''), '.', i), '[^0-9].*$', ''), '')::INTEGER, 0);
    IF x < y THEN RETURN -1; END IF;
    IF x > y THEN RETURN 1; END IF;
  END LOOP;
  RETURN 0;
END;
$$;

-- ── 3. What is live ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_announcements(p_audience TEXT, p_app_version TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, title TEXT, message TEXT, kind TEXT, link_label TEXT, link_url TEXT, starts_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, btrim(a.title), btrim(a.message), a.kind, a.link_label, a.link_url, a.starts_at
  FROM public.announcements a
  WHERE p_audience IN ('customer', 'owner')
    AND a.audience IN (p_audience, 'both')
    AND a.starts_at <= NOW()
    AND (a.ends_at IS NULL OR a.ends_at > NOW())
    AND (p_app_version IS NULL OR p_app_version !~ '^[0-9]+(\.[0-9]+){0,2}'
         OR ((a.min_app_version IS NULL OR public._version_cmp(p_app_version, a.min_app_version) >= 0)
             AND (a.max_app_version IS NULL OR public._version_cmp(p_app_version, a.max_app_version) <= 0)))
  ORDER BY (a.kind = 'important') DESC, a.starts_at DESC
  LIMIT 3;
$$;

REVOKE ALL ON FUNCTION public.get_active_announcements(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_announcements(TEXT, TEXT) TO anon, authenticated;

-- ── 4. The customer app's one call, now with announcements ──────────────────
DROP FUNCTION IF EXISTS public.get_customer_config();

CREATE OR REPLACE FUNCTION public.get_customer_config(p_app_version TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
           (SELECT jsonb_object_agg(c.key, c.value)
            FROM public.app_config c
            WHERE c.key IN ('maxRadiusMiles', 'showUnconfirmedMenuItems', 'minAppVersion')),
           '{}'::jsonb)
         || jsonb_build_object(
              'announcements',
              COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.get_active_announcements('customer', p_app_version) a), '[]'::jsonb)
            );
$$;

REVOKE ALL ON FUNCTION public.get_customer_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_config(TEXT) TO anon, authenticated;

-- ── 5. The admin page ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_announcements();

CREATE FUNCTION public.admin_list_announcements()
RETURNS TABLE (
  id UUID, audience TEXT, title TEXT, message TEXT, kind TEXT, link_label TEXT, link_url TEXT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, min_app_version TEXT, max_app_version TEXT,
  status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  RETURN QUERY
  SELECT a.id, a.audience, a.title, a.message, a.kind, a.link_label, a.link_url, a.starts_at, a.ends_at,
         a.min_app_version, a.max_app_version,
         CASE
           WHEN a.starts_at > NOW() THEN 'scheduled'
           WHEN a.ends_at IS NOT NULL AND a.ends_at <= NOW() THEN 'ended'
           ELSE 'live'
         END,
         a.created_at
  FROM public.announcements a
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_announcements() TO authenticated;

-- Creates (p_id NULL) or updates an announcement. Returns its id.
CREATE OR REPLACE FUNCTION public.admin_save_announcement(
  p_id UUID, p_audience TEXT, p_title TEXT, p_message TEXT, p_kind TEXT,
  p_link_label TEXT, p_link_url TEXT, p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ,
  p_min_app_version TEXT, p_max_app_version TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT := btrim(COALESCE(p_title, ''));
  v_msg   TEXT := btrim(COALESCE(p_message, ''));
  v_label TEXT := NULLIF(btrim(COALESCE(p_link_label, '')), '');
  v_url   TEXT := NULLIF(btrim(COALESCE(p_link_url, '')), '');
  v_min   TEXT := NULLIF(btrim(COALESCE(p_min_app_version, '')), '');
  v_max   TEXT := NULLIF(btrim(COALESCE(p_max_app_version, '')), '');
  v_start TIMESTAMPTZ := COALESCE(p_starts_at, NOW());
  v_id    UUID;
BEGIN
  PERFORM public._require_admin();

  IF p_audience IS NULL OR p_audience NOT IN ('customer', 'owner', 'both') THEN RAISE EXCEPTION 'Choose who the announcement is for'; END IF;
  IF COALESCE(p_kind, 'info') NOT IN ('info', 'important') THEN RAISE EXCEPTION 'The type must be info or important'; END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'The title must be 1 to 80 characters'; END IF;
  IF char_length(v_msg) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'The message must be 1 to 600 characters'; END IF;
  IF (v_label IS NULL) <> (v_url IS NULL) THEN RAISE EXCEPTION 'A link needs both a button label and a web address'; END IF;
  IF v_url IS NOT NULL AND (v_url !~* '^https://[^[:space:]]{4,}$' OR char_length(v_url) > 2000) THEN
    RAISE EXCEPTION 'The link must be a full web address starting with https://';
  END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 40 THEN RAISE EXCEPTION 'The link button label must be 40 characters or fewer'; END IF;
  IF v_min IS NOT NULL AND v_min !~ '^[0-9]+(\.[0-9]+){0,2}$' THEN RAISE EXCEPTION 'The lowest app version must look like 1.2.0'; END IF;
  IF v_max IS NOT NULL AND v_max !~ '^[0-9]+(\.[0-9]+){0,2}$' THEN RAISE EXCEPTION 'The highest app version must look like 1.2.0'; END IF;
  IF v_min IS NOT NULL AND v_max IS NOT NULL AND public._version_cmp(v_min, v_max) > 0 THEN
    RAISE EXCEPTION 'The lowest app version cannot be higher than the highest';
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at < v_start THEN RAISE EXCEPTION 'The end must be after the start'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.announcements (audience, title, message, kind, link_label, link_url, starts_at, ends_at,
                                      min_app_version, max_app_version, created_by)
    VALUES (p_audience, v_title, v_msg, COALESCE(p_kind, 'info'), v_label, v_url, v_start, p_ends_at, v_min, v_max, auth.uid())
    RETURNING announcements.id INTO v_id;
  ELSE
    UPDATE public.announcements a
       SET audience = p_audience, title = v_title, message = v_msg, kind = COALESCE(p_kind, 'info'),
           link_label = v_label, link_url = v_url, starts_at = v_start, ends_at = p_ends_at,
           min_app_version = v_min, max_app_version = v_max, updated_at = NOW()
     WHERE a.id = p_id
    RETURNING a.id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Announcement not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_announcement(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_announcement(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- Ends a live announcement now; a scheduled one that has not started is ended before it ever shows.
CREATE OR REPLACE FUNCTION public.admin_end_announcement(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  UPDATE public.announcements a
     SET ends_at = GREATEST(NOW(), a.starts_at), updated_at = NOW()
   WHERE a.id = p_id AND (a.ends_at IS NULL OR a.ends_at > NOW());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_end_announcement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_end_announcement(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_admin();
  DELETE FROM public.announcements a WHERE a.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_announcement(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
