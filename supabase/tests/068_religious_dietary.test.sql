-- Tests for migration 068: is_religious_dietary_value and strip_religious_dietary.
-- These two functions define what PikMe refuses to store or use, and they are
-- pure (no auth needed), so they can be tested here. upsert_user_profile and
-- get_user_profile call them but depend on auth.uid() and user rows, so check
-- those through the app (see the checklist at the bottom).
--
-- Run in the Supabase SQL editor (or psql -f). Success: "PASS: ..." notices and
-- no error. Safe to run: it reads nothing and writes nothing.

DO $$
BEGIN
  -- ── is_religious_dietary_value ─────────────────────────────────────────────
  ASSERT public.is_religious_dietary_value('halal'), 'halal';
  ASSERT public.is_religious_dietary_value('kosher'), 'kosher';
  ASSERT public.is_religious_dietary_value('hindu_meal'), 'hindu_meal';
  ASSERT public.is_religious_dietary_value('Halal'), 'case-insensitive: Halal';
  ASSERT public.is_religious_dietary_value('KOSHER'), 'case-insensitive: KOSHER';
  ASSERT public.is_religious_dietary_value('halal_certified'), 'variant: halal_certified';
  ASSERT public.is_religious_dietary_value('jain'), 'jain';
  ASSERT public.is_religious_dietary_value('buddhist'), 'buddhist';
  ASSERT public.is_religious_dietary_value('religious_diet'), 'religious_diet';
  RAISE NOTICE 'PASS: religious values are recognised';

  ASSERT NOT public.is_religious_dietary_value('vegetarian'), 'vegetarian is not religious';
  ASSERT NOT public.is_religious_dietary_value('vegan'), 'vegan is not religious';
  ASSERT NOT public.is_religious_dietary_value('gluten_free'), 'gluten_free is not religious';
  ASSERT NOT public.is_religious_dietary_value('none'), 'none is not religious';
  ASSERT NOT public.is_religious_dietary_value('peanuts'), 'allergen is not religious';
  ASSERT NOT public.is_religious_dietary_value('low_sodium'), 'health goal is not religious';
  ASSERT NOT public.is_religious_dietary_value(''), 'empty string';
  ASSERT NOT public.is_religious_dietary_value(NULL), 'NULL';
  RAISE NOTICE 'PASS: health/diet values are not flagged';

  -- ── strip_religious_dietary ────────────────────────────────────────────────
  ASSERT public.strip_religious_dietary(ARRAY['vegan','halal','gluten_free','kosher'])
         = ARRAY['vegan','gluten_free'], 'drops religious values, keeps the rest';
  ASSERT public.strip_religious_dietary(ARRAY['gluten_free','vegan','vegetarian'])
         = ARRAY['gluten_free','vegan','vegetarian'], 'keeps order when nothing is dropped';
  ASSERT public.strip_religious_dietary(ARRAY['vegetarian','hindu_meal','vegan'])
         = ARRAY['vegetarian','vegan'], 'keeps relative order after dropping';
  ASSERT public.strip_religious_dietary(ARRAY['halal','kosher','Hindu_Meal']) = '{}',
         'only religious values -> empty';
  ASSERT public.strip_religious_dietary('{}') = '{}', 'empty -> empty';
  ASSERT public.strip_religious_dietary(NULL) = '{}', 'NULL -> empty (never NULL)';
  ASSERT public.strip_religious_dietary(ARRAY['vegan', NULL]) = ARRAY['vegan'], 'NULL elements dropped';
  ASSERT public.strip_religious_dietary(ARRAY['none']) = ARRAY['none'], 'none preserved';
  RAISE NOTICE 'PASS: strip_religious_dietary';

  RAISE NOTICE 'ALL 068 TESTS PASSED';
END $$;

-- ── App-level checks (cannot be scripted here) ───────────────────────────────
-- 1. Onboarding dietary step and Profile screen: only Vegetarian, Vegan,
--    Gluten-Free and No Restrictions are offered.
-- 2. A user who previously saved halal/kosher: after 068, get_user_profile
--    (and so the Profile screen, recommendations, chat) no longer shows it.
--    In SQL, as that user's id:
--      select public.get_user_profile()->'dietaryRestrictions';   -- no halal/kosher
-- 3. Saving a profile that includes 'halal' stores nothing for it:
--      select value from user_dietary_restrictions where user_id = '<id>';
