-- A customer's Saved tab should not list a restaurant that is no longer
-- offered, matching what fetch-nearby-restaurants already hides from search:
-- a claimed restaurant that an admin marked closed, that its owner paused, or
-- (new) whose owner has been deactivated/blocked (restaurant_owners.is_active
-- = false). Their saved rows are left in place, not deleted, so a restaurant
-- reappears in the Saved tab if the owner is reactivated or it's reopened.
-- Unclaimed restaurants (no matching restaurants row) are unaffected.
CREATE OR REPLACE FUNCTION public.get_saved_items()
RETURNS JSONB AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
  RETURN jsonb_build_object(
    'restaurants', COALESCE(
      (SELECT jsonb_agg(row_to_json(r.*) ORDER BY sr.saved_at DESC)
       FROM public.saved_restaurants sr
       LEFT JOIN public.cached_restaurants r ON r.place_id = sr.place_id
       WHERE sr.user_id = v_user_id
         AND NOT EXISTS (
           SELECT 1
           FROM public.restaurants cr
           LEFT JOIN public.restaurant_owners ro ON ro.id = cr.owner_id
           WHERE cr.google_place_id = sr.place_id
             AND (
               cr.status = 'closed'
               OR cr.is_paused
               OR ro.is_active = false
             )
         )),
      '[]'::JSONB
    ),
    'menuItems', COALESCE(
      (SELECT jsonb_agg(row_to_json(m.*) ORDER BY sm.saved_at DESC)
       FROM public.saved_menu_items sm
       LEFT JOIN public.menu_items m ON m.item_id = sm.item_id
       WHERE sm.user_id = v_user_id),
      '[]'::JSONB
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
