-- Powers the consumer app's "Coupons Only" filter on the Explore tab: one
-- call returns the google_place_id of every restaurant that currently has at
-- least one coupon this user could actually see, instead of the app calling
-- get_active_coupons_for_restaurant once per restaurant card.
--
-- The WHERE clause mirrors get_active_coupons_for_restaurant (038) exactly —
-- not deleted, active, unexpired, total usage not exhausted, and this user
-- hasn't hit their own per-customer cap — each with the same "open
-- activation window still counts" exception, so the filter and the per-card
-- coupon badge can never disagree.
CREATE OR REPLACE FUNCTION public.get_place_ids_with_active_coupons()
RETURNS TABLE (google_place_id TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT r.google_place_id
  FROM public.coupons c
  JOIN public.restaurants r ON r.id = c.restaurant_id
  LEFT JOIN LATERAL (
    SELECT ca.activated_at
    FROM public.coupon_activations ca
    WHERE ca.coupon_id = c.id AND ca.user_id = auth.uid() AND ca.closed_at IS NULL
    LIMIT 1
  ) openact ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS use_count
    FROM public.coupon_activations ca2
    WHERE ca2.coupon_id = c.id AND ca2.user_id = auth.uid()
  ) counts ON true
  WHERE c.is_deleted = false
    AND c.is_active = true
    AND c.expiry_date > NOW()
    AND (c.usage_limit IS NULL OR c.times_used < c.usage_limit OR openact.activated_at IS NOT NULL)
    AND (COALESCE(counts.use_count, 0) < c.per_user_limit OR openact.activated_at IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_place_ids_with_active_coupons() TO authenticated;
