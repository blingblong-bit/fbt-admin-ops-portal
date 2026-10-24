ALTER TABLE public.package_overrides ADD COLUMN IF NOT EXISTS square_booking_id text;

CREATE OR REPLACE FUNCTION public.start_pending_override_from_square(p_client_id uuid, p_booking_id text, p_start date, p_total int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c public.clients;
  v_pen public.package_overrides;
  v_cur public.package_overrides;
  v_new public.package_overrides;
  v_gate date;
  v_size int;
BEGIN
  IF COALESCE(btrim(p_booking_id),'') = '' OR p_start IS NULL OR p_total IS NULL THEN RAISE EXCEPTION 'Square evidence required'; END IF;
  SELECT * INTO v_c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  SELECT * INTO v_pen FROM public.package_overrides WHERE client_id = p_client_id AND slot = 'pending' AND cleared_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No prepared package override'; END IF;
  IF v_pen.status = 'active' AND v_pen.square_booking_id = p_booking_id THEN
    RETURN jsonb_build_object('changed', false, 'id', v_pen.id);
  END IF;
  IF v_pen.status <> 'prepared' THEN RAISE EXCEPTION 'Prepared override is not waiting to start'; END IF;
  SELECT * INTO v_cur FROM public.package_overrides WHERE client_id = p_client_id AND slot = 'current' AND cleared_at IS NULL;
  IF FOUND AND v_cur.visits_used IS NOT NULL THEN RAISE EXCEPTION 'Current package has an admin visit count; staff must start it'; END IF;
  v_gate := COALESCE(v_pen.start_date, v_c.pending_renewal_start_date);
  v_size := COALESCE(v_pen.total_visits, v_c.pending_renewal_total_visits);
  IF v_gate IS NOT NULL AND p_start < v_gate THEN RAISE EXCEPTION 'Square 1-of-N is before the prepared start'; END IF;
  IF v_size IS NOT NULL AND v_size <> p_total THEN RAISE EXCEPTION 'Square package size does not match'; END IF;
  UPDATE public.package_overrides SET cleared_at = now(), clear_reason = 'Started by verified Square 1/' || p_total || ' on ' || p_start WHERE id = v_pen.id;
  INSERT INTO public.package_overrides(client_id, slot, total_visits, visits_used, price, recognized_paid, start_date, status, reason, actor, square_booking_id)
  VALUES (p_client_id, 'pending', v_size, NULL, v_pen.price, v_pen.recognized_paid, p_start, 'active',
    'Started by verified Square 1/' || p_total || ' on ' || p_start || ' (was: ' || v_pen.reason || ')', NULL, p_booking_id)
  RETURNING * INTO v_new;
  INSERT INTO public.client_activities(client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'package_override', 'Prepared package started by verified Square 1/' || p_total || ' on ' || p_start,
    jsonb_build_object('slot', 'pending', 'actor', NULL, 'source', 'square_activation', 'booking_id', p_booking_id,
      'before', to_jsonb(v_pen), 'after', to_jsonb(v_new)));
  RETURN jsonb_build_object('changed', true, 'id', v_new.id);
END $$;

REVOKE EXECUTE ON FUNCTION public.start_pending_override_from_square(uuid, text, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_pending_override_from_square(uuid, text, date, int) TO service_role;