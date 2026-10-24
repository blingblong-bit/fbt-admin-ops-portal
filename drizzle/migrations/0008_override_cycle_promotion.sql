ALTER TABLE public.package_overrides ADD COLUMN IF NOT EXISTS raw_baseline jsonb;

CREATE OR REPLACE FUNCTION public.package_overrides_set_baseline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slot = 'current' AND NEW.baseline_visits_used IS NULL THEN
    SELECT visits_used INTO NEW.baseline_visits_used FROM public.clients WHERE id = NEW.client_id;
  END IF;
  IF NEW.raw_baseline IS NULL THEN
    SELECT jsonb_build_object('amount_paid', amount_paid, 'pending_paid', pending_renewal_paid, 'prev_owed', previous_package_owed)
      INTO NEW.raw_baseline FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $$;

-- Backfill: payments recorded from now on count on top of existing admin figures.
UPDATE public.package_overrides o SET raw_baseline = jsonb_build_object('amount_paid', c.amount_paid, 'pending_paid', c.pending_renewal_paid, 'prev_owed', c.previous_package_owed)
FROM public.clients c WHERE c.id = o.client_id AND o.cleared_at IS NULL AND o.raw_baseline IS NULL;

DROP FUNCTION IF EXISTS public.start_pending_override_from_square(uuid, text, date, int);

-- Square started the prepared package of a client whose package figures are
-- admin financial/date-only overrides. Figures are computed by the app's
-- applyOverrides (one source of truth) and validated here; writes are atomic,
-- guarded against concurrent change, idempotent per Square booking, audited.
CREATE OR REPLACE FUNCTION public.start_pending_override_from_square(p_client_id uuid, p_booking_id text, p_start date, p_total int, p_figures jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur public.package_overrides;
  v_pen public.package_overrides;
  v_prev public.package_overrides;
  v_new public.package_overrides;
  v_newprev public.package_overrides;
  v_gate date := NULLIF(p_figures->>'gate','')::date;
  v_price numeric := NULLIF(p_figures->>'price','')::numeric;
  v_paid numeric := NULLIF(p_figures->>'recognized_paid','')::numeric;
  v_prev_owed numeric := NULLIF(p_figures->>'prev_owed','')::numeric;
  v_exp_cur uuid := NULLIF(p_figures->>'expect_current_id','')::uuid;
  v_exp_pen uuid := NULLIF(p_figures->>'expect_pending_id','')::uuid;
  v_tag text;
BEGIN
  IF COALESCE(btrim(p_booking_id),'') = '' OR p_start IS NULL OR p_total IS NULL OR p_total < 1 THEN RAISE EXCEPTION 'Square evidence required'; END IF;
  IF v_gate IS NULL THEN RAISE EXCEPTION 'Prepared start date required'; END IF;
  IF p_start < v_gate THEN RAISE EXCEPTION 'Square 1-of-N is before the prepared start'; END IF;
  IF v_price IS NULL OR v_paid IS NULL OR v_price < 0 OR v_paid < 0 OR COALESCE(v_prev_owed,0) < 0 THEN RAISE EXCEPTION 'Invalid package figures'; END IF;
  IF COALESCE((p_figures->>'total')::int, p_total) <> p_total THEN RAISE EXCEPTION 'Square package size does not match'; END IF;
  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  SELECT * INTO v_cur FROM public.package_overrides WHERE client_id = p_client_id AND slot = 'current' AND cleared_at IS NULL;
  IF v_cur.id IS NOT NULL AND v_cur.square_booking_id = p_booking_id THEN
    RETURN jsonb_build_object('changed', false, 'id', v_cur.id);
  END IF;
  SELECT * INTO v_pen FROM public.package_overrides WHERE client_id = p_client_id AND slot = 'pending' AND cleared_at IS NULL;
  SELECT * INTO v_prev FROM public.package_overrides WHERE client_id = p_client_id AND slot = 'previous' AND cleared_at IS NULL;
  IF v_cur.id IS DISTINCT FROM v_exp_cur OR v_pen.id IS DISTINCT FROM v_exp_pen THEN RAISE EXCEPTION 'Package overrides changed; re-check'; END IF;
  IF v_cur.id IS NULL AND v_pen.id IS NULL THEN RAISE EXCEPTION 'No package override to continue'; END IF;
  IF v_cur.visits_used IS NOT NULL THEN RAISE EXCEPTION 'Current package has an admin visit count; staff must start it'; END IF;
  IF v_pen.id IS NOT NULL AND v_pen.status <> 'prepared' THEN RAISE EXCEPTION 'Prepared override is not waiting to start'; END IF;
  v_tag := 'Started by verified Square 1/' || p_total || ' on ' || p_start;
  UPDATE public.package_overrides SET cleared_at = now(), clear_reason = v_tag
    WHERE id IN (v_cur.id, v_pen.id) OR (v_prev_owed IS NOT NULL AND id = v_prev.id);
  IF v_prev_owed IS NOT NULL AND v_prev_owed > 0 THEN
    INSERT INTO public.package_overrides(client_id, slot, price, recognized_paid, status, reason, actor)
    VALUES (p_client_id, 'previous', v_prev_owed, 0, 'completed', v_tag || ': unpaid prior balance carried once', NULL)
    RETURNING * INTO v_newprev;
  END IF;
  INSERT INTO public.package_overrides(client_id, slot, total_visits, visits_used, price, recognized_paid, start_date, status, reason, actor, square_booking_id)
  VALUES (p_client_id, 'current', p_total, NULL, v_price, v_paid, p_start, 'active', v_tag, NULL, p_booking_id)
  RETURNING * INTO v_new;
  INSERT INTO public.client_activities(client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'package_override', 'Next package started: ' || v_tag,
    jsonb_build_object('source', 'square_activation', 'booking_id', p_booking_id, 'actor', NULL,
      'before', jsonb_build_object('current', to_jsonb(v_cur), 'pending', to_jsonb(v_pen), 'previous', to_jsonb(v_prev)),
      'after', jsonb_build_object('current', to_jsonb(v_new), 'previous', to_jsonb(v_newprev))));
  RETURN jsonb_build_object('changed', true, 'id', v_new.id);
END $$;

REVOKE EXECUTE ON FUNCTION public.start_pending_override_from_square(uuid, text, date, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_pending_override_from_square(uuid, text, date, int, jsonb) TO service_role;