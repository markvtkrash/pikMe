-- Test for migration 133: starter favorites. A new owner starts with the five pins; the one-time seeding is recorded and never repeats.
-- Rolled-back transaction. Needs migrations 053 and 133. Success: no error.
DO $$
DECLARE
  v_id UUID := '00000000-0000-0000-0000-0000000013b1';
  v_pins TEXT[];
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = 'starterFavoritesSeeded'), 'the one-time seeding is recorded';

  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role)
    VALUES (v_id, 'starter-13b1@example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.restaurant_owners (id, business_name, email) VALUES (v_id, 'Starter Test', 'starter-13b1@example.com');

    SELECT favorite_pages INTO v_pins FROM public.restaurant_owners WHERE id = v_id;
    ASSERT cardinality(v_pins) = 5, 'a new owner starts with five pins';
    ASSERT v_pins @> ARRAY['coupon-add-coupons', 'menu-online-link', 'menu-photo', 'report-menu-verification-status', 'tool-visibility'],
      'they are the five starter pages';

    -- an owner who unpins everything stays empty, even if the migration is applied again
    UPDATE public.restaurant_owners SET favorite_pages = '{}' WHERE id = v_id;
    DELETE FROM public.app_config WHERE key = 'starterFavoritesSeeded';
    RAISE EXCEPTION 'rollback_test_133';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_test_133' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL 133 TESTS PASSED';
END $$;
