CREATE TABLE public.package_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  slot text NOT NULL CHECK (slot IN ('current','pending','previous')),
  total_visits integer,
  visits_used integer,
  price numeric,
  recognized_paid numeric,
  start_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','prepared','completed')),
  reason text NOT NULL,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid,
  clear_reason text
);
CREATE UNIQUE INDEX package_overrides_one_active ON public.package_overrides(client_id, slot) WHERE cleared_at IS NULL;
GRANT SELECT ON public.package_overrides TO authenticated;
GRANT ALL ON public.package_overrides TO service_role;
ALTER TABLE public.package_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view package overrides" ON public.package_overrides FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.set_package_override(p_client_id uuid, p_slot text, p_values jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.package_overrides;
  v_new public.package_overrides;
  v_tv int := NULLIF(p_values->>'total_visits','')::int;
  v_vu int := NULLIF(p_values->>'visits_used','')::int;
  v_pr numeric := NULLIF(p_values->>'price','')::numeric;
  v_pd numeric := NULLIF(p_values->>'recognized_paid','')::numeric;
  v_sd date := NULLIF(p_values->>'start_date','')::date;
  v_st text := COALESCE(NULLIF(p_values->>'status',''), 'active');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can override packages.'; END IF;
  IF p_slot NOT IN ('current','pending','previous') THEN RAISE EXCEPTION 'Unknown package'; END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF v_tv IS NOT NULL AND v_tv < 1 THEN RAISE EXCEPTION 'Package size must be at least 1'; END IF;
  IF v_vu IS NOT NULL AND (v_vu < 0 OR (v_tv IS NOT NULL AND v_vu > v_tv)) THEN RAISE EXCEPTION 'Visits used must be between 0 and the package size'; END IF;
  IF COALESCE(v_pr,0) < 0 OR COALESCE(v_pd,0) < 0 THEN RAISE EXCEPTION 'Amounts cannot be negative'; END IF;
  IF v_st NOT IN ('active','prepared','completed') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  SELECT * INTO v_old FROM public.package_overrides WHERE client_id = p_client_id AND slot = p_slot AND cleared_at IS NULL;
  IF FOUND AND v_old.total_visits IS NOT DISTINCT FROM v_tv AND v_old.visits_used IS NOT DISTINCT FROM v_vu
     AND v_old.price IS NOT DISTINCT FROM v_pr AND v_old.recognized_paid IS NOT DISTINCT FROM v_pd
     AND v_old.start_date IS NOT DISTINCT FROM v_sd AND v_old.status = v_st THEN
    RETURN jsonb_build_object('changed', false, 'id', v_old.id);
  END IF;
  IF v_old.id IS NOT NULL THEN
    UPDATE public.package_overrides SET cleared_at = now(), cleared_by = auth.uid(), clear_reason = 'Replaced: ' || btrim(p_reason) WHERE id = v_old.id;
  END IF;
  INSERT INTO public.package_overrides(client_id, slot, total_visits, visits_used, price, recognized_paid, start_date, status, reason, actor)
  VALUES (p_client_id, p_slot, v_tv, v_vu, v_pr, v_pd, v_sd, v_st, btrim(p_reason), auth.uid()) RETURNING * INTO v_new;
  INSERT INTO public.client_activities(client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'package_override', 'Admin package override set (' || p_slot || '): ' || btrim(p_reason),
    jsonb_build_object('slot', p_slot, 'actor', auth.uid(), 'reason', btrim(p_reason),
      'before', CASE WHEN v_old.id IS NULL THEN NULL ELSE to_jsonb(v_old) END, 'after', to_jsonb(v_new)));
  RETURN jsonb_build_object('changed', true, 'id', v_new.id);
END $$;

CREATE OR REPLACE FUNCTION public.clear_package_override(p_client_id uuid, p_slot text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old public.package_overrides;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can clear package overrides.'; END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_old FROM public.package_overrides WHERE client_id = p_client_id AND slot = p_slot AND cleared_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('changed', false); END IF;
  UPDATE public.package_overrides SET cleared_at = now(), cleared_by = auth.uid(), clear_reason = btrim(p_reason) WHERE id = v_old.id;
  INSERT INTO public.client_activities(client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'package_override_cleared', 'Admin override cleared (' || p_slot || '), automatic tracking resumed: ' || btrim(p_reason),
    jsonb_build_object('slot', p_slot, 'actor', auth.uid(), 'reason', btrim(p_reason), 'before', to_jsonb(v_old), 'after', NULL));
  RETURN jsonb_build_object('changed', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.set_package_override(uuid, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_package_override(uuid, text, text) FROM anon;