-- Admin: permanently delete a claimed restaurant (Manage Restaurants), with its data.
--
-- Only a CLOSED restaurant can be deleted (close it first: that is the reversible step and
-- keeps history; this is the permanent one). Frees the Google place ID, which is UNIQUE on
-- public.restaurants, so the same location can be claimed again as a fresh restaurant.
--
-- Deleted:
--   * the restaurants row, and through the existing ON DELETE CASCADE foreign keys: its
--     coupons (and customers' coupon activations), restaurant_menu_items, support_tickets
--     and relocation requests
--   * its own per-location menu rows (menu_items.place_id = its place ID, migration 067) and,
--     through the cascade from 030, customers' saved copies of them
--   * the shared name-keyed menu rows under its name (menu_items.place_id IS NULL), but ONLY
--     when nothing else uses that name: it is not a franchise chain, no other claimed
--     restaurant has the name and no other cached location has it (same rule as 064)
-- Kept on purpose:
--   * the owner account (restaurant_owners), so the owner can claim another restaurant
--   * the public cached_restaurants listing and customers' saved restaurants (Google data;
--     it expires on its own now that no claim exempts it)
--   * a franchise chain's shared menu (chain_ items), always
--
-- p_dry_run = true returns the same counts without deleting anything (for the confirm
-- window). One transaction; returns JSON counts. SECURITY DEFINER + _require_admin(),
-- signed-in users only (the admin check is inside), never anon. Safe to re-run.
CREATE OR REPLACE FUNCTION public.admin_delete_restaurant(
  p_restaurant_id UUID,
  p_dry_run       BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r             public.restaurants%ROWTYPE;
  v_coupons       INTEGER;
  v_activations   INTEGER;
  v_owner_items   INTEGER;
  v_tickets       INTEGER;
  v_relocations   INTEGER;
  v_loc_items     INTEGER;
  v_shared_items  INTEGER := 0;
  v_saved_copies  INTEGER;
  v_share_name    BOOLEAN;
BEGIN
  PERFORM public._require_admin();

  SELECT * INTO v_r FROM public.restaurants WHERE id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;
  IF v_r.status <> 'closed' THEN
    RAISE EXCEPTION 'Close the restaurant before deleting it (current status: %)', v_r.status;
  END IF;

  SELECT COUNT(*) INTO v_coupons     FROM public.coupons c WHERE c.restaurant_id = v_r.id;
  SELECT COUNT(*) INTO v_activations FROM public.coupon_activations a
    WHERE a.coupon_id IN (SELECT c.id FROM public.coupons c WHERE c.restaurant_id = v_r.id);
  SELECT COUNT(*) INTO v_owner_items FROM public.restaurant_menu_items m WHERE m.restaurant_id = v_r.id;
  SELECT COUNT(*) INTO v_tickets     FROM public.support_tickets t WHERE t.restaurant_id = v_r.id;
  SELECT COUNT(*) INTO v_relocations FROM public.restaurant_relocation_requests q WHERE q.restaurant_id = v_r.id;
  SELECT COUNT(*) INTO v_loc_items   FROM public.menu_items mi WHERE mi.place_id = v_r.google_place_id;

  -- Is the name-keyed template used by anything else?
  v_share_name :=
    public.is_franchise_chain(v_r.name)
    OR EXISTS (SELECT 1 FROM public.restaurants o WHERE o.name = v_r.name AND o.id <> v_r.id)
    OR EXISTS (SELECT 1 FROM public.cached_restaurants cr WHERE cr.name = v_r.name AND cr.place_id <> v_r.google_place_id);
  IF NOT v_share_name THEN
    SELECT COUNT(*) INTO v_shared_items FROM public.menu_items mi
      WHERE mi.place_id IS NULL AND mi.restaurant_name = v_r.name;
  END IF;

  SELECT COUNT(*) INTO v_saved_copies FROM public.saved_menu_items s
    WHERE s.item_id IN (
      SELECT mi.item_id FROM public.menu_items mi
      WHERE mi.place_id = v_r.google_place_id
         OR (NOT v_share_name AND mi.place_id IS NULL AND mi.restaurant_name = v_r.name)
    );

  IF NOT COALESCE(p_dry_run, FALSE) THEN
    DELETE FROM public.menu_items mi WHERE mi.place_id = v_r.google_place_id;
    IF NOT v_share_name THEN
      DELETE FROM public.menu_items mi WHERE mi.place_id IS NULL AND mi.restaurant_name = v_r.name;
    END IF;
    -- coupons, activations, owner menu items, tickets and relocation requests go with it (cascade)
    DELETE FROM public.restaurants WHERE id = v_r.id;
  END IF;

  RETURN jsonb_build_object(
    'dryRun', COALESCE(p_dry_run, FALSE),
    'restaurant', v_r.name,
    'coupons', v_coupons,
    'couponActivations', v_activations,
    'ownerMenuItems', v_owner_items,
    'supportTickets', v_tickets,
    'relocationRequests', v_relocations,
    'locationMenuItems', v_loc_items,
    'sharedMenuItems', v_shared_items,
    'sharedMenuKept', v_share_name,
    'savedCopies', v_saved_copies
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_restaurant(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_restaurant(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
