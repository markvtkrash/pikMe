-- Pickup ordering, stage 4 (database, second part): the customer's list of orders, and a switch for TEST payments.
--
--   get_my_orders(limit)            customer: their recent orders, newest first, as JSON (no dishes: the list shows a count).
--   test_mark_my_order_paid(order)  customer: pretends the payment went through, ONLY while the admin setting orderingTestMode is
--                                   'true' (default 'false'). For trying the whole flow before Stripe is connected: it does what the
--                                   payment confirmation will do later (mark_order_paid), and nothing else. With the setting off it
--                                   refuses, so it does nothing in production.
--
-- Safe to re-run.

INSERT INTO public.app_config (key, value, description, env_var_name) VALUES
  ('orderingTestMode', 'false', 'TESTING ONLY. While true, a signed-in customer can mark their own unpaid order as paid without paying (so the whole ordering flow can be tried before Stripe is connected). Keep false in production.', 'Edge function: no env equivalent, DB-only')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  env_var_name = EXCLUDED.env_var_name;

CREATE OR REPLACE FUNCTION public.get_my_orders(p_limit INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at DESC), '[]'::JSONB)
  FROM (
    SELECT o.created_at,
           jsonb_build_object(
             'order_id', o.id,
             'status', o.status,
             'restaurant_name', o.restaurant_name,
             'place_id', o.place_id,
             'pickup_at', o.pickup_at,
             'total_cents', o.total_cents,
             'refund_status', o.refund_status,
             'created_at', o.created_at,
             'item_count', COALESCE((SELECT SUM(i.quantity) FROM public.order_items i WHERE i.order_id = o.id), 0)
           ) AS row_json
    FROM public.orders o
    WHERE o.customer_id = auth.uid()
    ORDER BY o.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  ) recent;
$$;

CREATE OR REPLACE FUNCTION public.test_mark_my_order_paid(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT lower(btrim(c.value)) = 'true' FROM public.app_config c WHERE c.key = 'orderingTestMode'), FALSE) THEN
    RAISE EXCEPTION 'Test payments are switched off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.customer_id = auth.uid()) THEN
    RETURN 'not_found';
  END IF;
  RETURN public.mark_order_paid(p_order_id, 'pi_test_' || replace(p_order_id::TEXT, '-', ''));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_orders(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.test_mark_my_order_paid(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_orders(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_mark_my_order_paid(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
