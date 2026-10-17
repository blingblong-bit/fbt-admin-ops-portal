
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_renewal_key text;

CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  payment_ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('original','transfer')),
  bucket text NOT NULL CHECK (bucket IN ('previous','current','pending')),
  amount numeric NOT NULL,
  transfer_id uuid,
  reason text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_ref_idx ON public.payment_allocations (client_id, payment_ref);
CREATE UNIQUE INDEX payment_allocations_original_once ON public.payment_allocations (client_id, payment_ref, bucket) WHERE kind = 'original';
GRANT SELECT ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view payment allocations" ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','superadmin'))
$$;

-- Move part of ONE identified payment between previous-debt / current / prepared.
CREATE OR REPLACE FUNCTION public.reallocate_payment(
  p_client_id uuid, p_payment_ref text, p_from text, p_to text, p_amount numeric, p_reason text)
RETURNS TABLE(bucket text, amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.clients%ROWTYPE;
  act record;
  v_total numeric; v_p numeric; v_c numeric; v_d numeric;
  v_avail numeric;
  v_tid uuid := gen_random_uuid();
  v_prev numeric; v_paid numeric; v_pend numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can move payments';
  END IF;
  IF p_from NOT IN ('previous','current','pending') OR p_to NOT IN ('previous','current','pending') OR p_from = p_to THEN
    RAISE EXCEPTION 'Choose two different places to move money between';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter an amount greater than 0'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  SELECT id, created_at, metadata INTO act FROM public.client_activities
   WHERE client_id = p_client_id AND activity_type = 'payment'
     AND metadata->>'square_payment_id' = p_payment_ref
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment % is not recorded on this client', p_payment_ref; END IF;

  IF EXISTS (SELECT 1 FROM public.client_activities a
     WHERE a.client_id = p_client_id AND a.created_at > act.created_at
       AND (a.activity_type IN ('renewal','package_completed','pre_renewal_cancelled','notes_ledger_import','renewal_undone')
            OR (a.activity_type = 'edit' AND coalesce(a.metadata->>'money_changed','true') <> 'false'))) THEN
    RAISE EXCEPTION 'Needs Review: the package or balance changed after this payment, so its split cannot be confirmed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_allocations pa WHERE pa.client_id = p_client_id AND pa.payment_ref = p_payment_ref AND pa.kind = 'original') THEN
    v_total := (act.metadata->>'amount')::numeric;
    v_p := (act.metadata->>'applied_to_previous_package')::numeric;
    v_c := (act.metadata->>'applied_to_current_package')::numeric;
    v_d := (act.metadata->>'applied_to_pending_package')::numeric;
    IF v_total IS NULL OR v_p IS NULL OR v_c IS NULL OR v_d IS NULL OR abs(v_p + v_c + v_d - v_total) > 0.005 THEN
      RAISE EXCEPTION 'Needs Review: the original split of this payment is not recorded';
    END IF;
    INSERT INTO public.payment_allocations (client_id, payment_ref, kind, bucket, amount, reason, actor) VALUES
      (p_client_id, p_payment_ref, 'original', 'previous', v_p, 'Reconstructed from payment record', auth.uid()),
      (p_client_id, p_payment_ref, 'original', 'current', v_c, 'Reconstructed from payment record', auth.uid()),
      (p_client_id, p_payment_ref, 'original', 'pending', v_d, 'Reconstructed from payment record', auth.uid());
  END IF;

  SELECT coalesce(sum(pa.amount),0) INTO v_avail FROM public.payment_allocations pa
   WHERE pa.client_id = p_client_id AND pa.payment_ref = p_payment_ref AND pa.bucket = p_from;
  IF p_amount > v_avail + 0.0001 THEN
    RAISE EXCEPTION 'Only $% of this payment is currently on that package', v_avail;
  END IF;

  v_prev := coalesce(c.previous_package_owed,0); v_paid := coalesce(c.amount_paid,0); v_pend := coalesce(c.pending_renewal_paid,0);
  -- Taking money back out of a bucket.
  IF p_from = 'previous' THEN v_prev := v_prev + p_amount;          -- debt it had cleared is owed again
  ELSIF p_from = 'current' THEN
    IF v_paid < p_amount THEN RAISE EXCEPTION 'Current package paid is below that amount'; END IF;
    v_paid := v_paid - p_amount;
  ELSE
    IF v_pend < p_amount THEN RAISE EXCEPTION 'Prepared renewal paid is below that amount'; END IF;
    v_pend := v_pend - p_amount;
  END IF;
  -- Putting it into the destination.
  IF p_to = 'previous' THEN
    IF v_prev < p_amount THEN RAISE EXCEPTION 'Previous package owes only $%', v_prev; END IF;
    v_prev := v_prev - p_amount;                                     -- pays down debt
  ELSIF p_to = 'current' THEN v_paid := v_paid + p_amount;
  ELSE
    IF c.pending_renewal_start_date IS NULL THEN RAISE EXCEPTION 'There is no prepared renewal to move money onto'; END IF;
    v_pend := v_pend + p_amount;
  END IF;

  UPDATE public.clients SET previous_package_owed = v_prev, amount_paid = v_paid, pending_renewal_paid = v_pend WHERE id = p_client_id;

  INSERT INTO public.payment_allocations (client_id, payment_ref, kind, bucket, amount, transfer_id, reason, actor) VALUES
    (p_client_id, p_payment_ref, 'transfer', p_from, -p_amount, v_tid, p_reason, auth.uid()),
    (p_client_id, p_payment_ref, 'transfer', p_to, p_amount, v_tid, p_reason, auth.uid());

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata) VALUES (
    p_client_id, 'payment_reallocation',
    'Moved $' || to_char(p_amount,'FM999999990.00') || ' of payment ' || right(p_payment_ref, 6) || ' from ' || p_from || ' to ' || p_to || ' — ' || p_reason,
    jsonb_build_object('payment_ref', p_payment_ref, 'from', p_from, 'to', p_to, 'amount', p_amount, 'reason', p_reason,
      'transfer_id', v_tid, 'actor', auth.uid(), 'money_changed', true,
      'before', jsonb_build_object('previous_package_owed', c.previous_package_owed, 'amount_paid', c.amount_paid, 'pending_renewal_paid', c.pending_renewal_paid),
      'after', jsonb_build_object('previous_package_owed', v_prev, 'amount_paid', v_paid, 'pending_renewal_paid', v_pend)));

  RETURN QUERY SELECT pa.bucket, sum(pa.amount) FROM public.payment_allocations pa
    WHERE pa.client_id = p_client_id AND pa.payment_ref = p_payment_ref GROUP BY pa.bucket;
END $$;
REVOKE ALL ON FUNCTION public.reallocate_payment(uuid,text,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reallocate_payment(uuid,text,text,text,numeric,text) TO authenticated;

-- Whitelisted client edit with before/after history. Money/billing fields need admin.
CREATE OR REPLACE FUNCTION public.update_client_details(p_client_id uuid, p_patch jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.clients%ROWTYPE;
  n public.clients%ROWTYPE;
  k text;
  allowed text[] := ARRAY['first_name','last_name','phone','email','package_name','package_total_visits','package_price',
    'package_start_date','visits_used','amount_paid','internal_notes','payment_model','manual_active','status',
    'billing_type','per_visit_rate','weekly_rate','billing_effective_date'];
  money text[] := ARRAY['package_price','amount_paid','payment_model','billing_type','per_visit_rate','weekly_rate','billing_effective_date'];
  billing text[] := ARRAY['billing_type','per_visit_rate','weekly_rate','billing_effective_date'];
  v_before jsonb := '{}'; v_after jsonb := '{}';
  v_money boolean := false; v_billing boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT k = ANY(allowed) THEN RAISE EXCEPTION 'Field % cannot be edited here', k; END IF;
    IF (to_jsonb(c)->k) IS DISTINCT FROM (p_patch->k)
       AND NOT (jsonb_typeof(to_jsonb(c)->k) = 'number' AND jsonb_typeof(p_patch->k) = 'number' AND (to_jsonb(c)->>k)::numeric = (p_patch->>k)::numeric) THEN
      v_before := v_before || jsonb_build_object(k, to_jsonb(c)->k);
      v_after := v_after || jsonb_build_object(k, p_patch->k);
      IF k = ANY(money) THEN v_money := true; END IF;
      IF k = ANY(billing) THEN v_billing := true; END IF;
    END IF;
  END LOOP;
  IF v_after = '{}'::jsonb THEN RETURN jsonb_build_object('changed', false); END IF;
  IF v_money AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can change prices, payments or billing'; END IF;

  n := jsonb_populate_record(c, v_after);
  IF n.billing_type NOT IN ('package','pay_per_visit','weekly') THEN RAISE EXCEPTION 'Unknown billing type'; END IF;
  IF n.billing_type = 'pay_per_visit' AND (coalesce(n.per_visit_rate,0) <= 0 OR n.billing_effective_date IS NULL) THEN
    RAISE EXCEPTION 'Pay-per-visit needs a rate and a start date'; END IF;
  IF n.billing_type = 'weekly' AND (coalesce(n.weekly_rate,0) <= 0 OR n.billing_effective_date IS NULL) THEN
    RAISE EXCEPTION 'Weekly billing needs a rate and a start date'; END IF;
  IF coalesce(n.per_visit_rate,0) < 0 OR coalesce(n.weekly_rate,0) < 0 OR n.package_price < 0 OR n.amount_paid < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative'; END IF;

  UPDATE public.clients SET
    first_name = n.first_name, last_name = n.last_name, phone = n.phone, email = n.email,
    package_name = n.package_name, package_total_visits = n.package_total_visits, package_price = n.package_price,
    package_start_date = n.package_start_date, visits_used = n.visits_used, amount_paid = n.amount_paid,
    internal_notes = n.internal_notes, payment_model = n.payment_model, manual_active = n.manual_active, status = n.status,
    billing_type = n.billing_type, per_visit_rate = n.per_visit_rate, weekly_rate = n.weekly_rate,
    billing_effective_date = n.billing_effective_date
  WHERE id = p_client_id;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata) VALUES (
    p_client_id, CASE WHEN v_billing THEN 'billing_change' ELSE 'edit' END,
    'Edited: ' || (SELECT string_agg(key || ' ' || coalesce(v_before->>key,'—') || ' → ' || coalesce(v_after->>key,'—'), '; ') FROM jsonb_object_keys(v_after) key)
      || CASE WHEN coalesce(trim(p_reason),'') <> '' THEN ' — ' || p_reason ELSE '' END,
    jsonb_build_object('before', v_before, 'after', v_after, 'money_changed', v_money, 'reason', p_reason, 'actor', auth.uid()));
  RETURN jsonb_build_object('changed', true, 'before', v_before, 'after', v_after);
END $$;
REVOKE ALL ON FUNCTION public.update_client_details(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_details(uuid,jsonb,text) TO authenticated;

-- Undo the most recent renewal when nothing has happened since.
CREATE OR REPLACE FUNCTION public.undo_last_renewal(p_client_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.clients%ROWTYPE;
  r record; pc record;
  v_prev numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can undo a renewal'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  SELECT id, created_at, metadata INTO r FROM public.client_activities
   WHERE client_id = p_client_id AND activity_type = 'renewal' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No renewal to undo'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_activities WHERE client_id = p_client_id AND activity_type = 'renewal_undone' AND created_at > r.created_at) THEN
    RAISE EXCEPTION 'This renewal was already undone'; END IF;
  SELECT id, metadata INTO pc FROM public.client_activities
   WHERE client_id = p_client_id AND activity_type = 'package_completed' AND created_at <= r.created_at
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR NOT (pc.metadata ?& ARRAY['package_total_visits','package_price','amount_paid','visits_used'])
     OR NOT (r.metadata ?& ARRAY['unpaid_carried_forward','prepaid_applied','amount_paid','package_price']) THEN
    RAISE EXCEPTION 'Needs Review: this renewal does not have enough saved history to undo'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_activities a WHERE a.client_id = p_client_id AND a.created_at > r.created_at
       AND (a.activity_type IN ('payment','visit','payment_reallocation','package_completed','renewal')
            OR (a.activity_type IN ('edit','billing_change') AND coalesce(a.metadata->>'money_changed','true') <> 'false'))) THEN
    RAISE EXCEPTION 'Needs Review: payments, visits or money edits happened after this renewal'; END IF;
  IF (r.metadata->>'prepaid_applied')::numeric > 0 OR (r.metadata->>'amount_paid')::numeric > 0 THEN
    RAISE EXCEPTION 'Needs Review: money was applied when this renewal started'; END IF;
  IF c.package_price IS DISTINCT FROM (r.metadata->>'package_price')::numeric OR coalesce(c.amount_paid,0) <> 0 THEN
    RAISE EXCEPTION 'Needs Review: the package changed since this renewal'; END IF;
  v_prev := coalesce(c.previous_package_owed,0) - (r.metadata->>'unpaid_carried_forward')::numeric;
  IF v_prev < -0.005 THEN RAISE EXCEPTION 'Needs Review: previous package balance no longer matches'; END IF;

  UPDATE public.clients SET
    package_name = pc.metadata->>'package_name',
    package_total_visits = (pc.metadata->>'package_total_visits')::int,
    package_start_date = nullif(pc.metadata->>'package_start_date','')::date,
    visits_used = (pc.metadata->>'visits_used')::int,
    package_price = (pc.metadata->>'package_price')::numeric,
    amount_paid = (pc.metadata->>'amount_paid')::numeric,
    previous_package_owed = greatest(0, v_prev),
    last_renewal_key = NULL
  WHERE id = p_client_id;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata) VALUES (
    p_client_id, 'renewal_undone', 'Renewal undone — previous package restored. ' || p_reason,
    jsonb_build_object('renewal_activity_id', r.id, 'reason', p_reason, 'actor', auth.uid(), 'money_changed', true,
      'before', jsonb_build_object('package_name', c.package_name, 'package_total_visits', c.package_total_visits, 'package_start_date', c.package_start_date,
         'visits_used', c.visits_used, 'package_price', c.package_price, 'amount_paid', c.amount_paid, 'previous_package_owed', c.previous_package_owed),
      'after', pc.metadata || jsonb_build_object('previous_package_owed', greatest(0, v_prev))));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.undo_last_renewal(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_last_renewal(uuid,text) TO authenticated;

-- Same signature; adds package-boundary protection against activating the same renewal twice.
CREATE OR REPLACE FUNCTION public.renew_client_package(p_client_id uuid, p_package_name text, p_total_visits integer, p_price numeric, p_start_date date, p_extra_paid numeric DEFAULT 0, p_source text DEFAULT 'manual_renewal'::text, p_booking_id text DEFAULT NULL::text, p_visits_used integer DEFAULT 0)
 RETURNS TABLE(previous_package_owed numeric, amount_paid numeric, prepaid_applied numeric, unpaid_carried_forward numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c public.clients%ROWTYPE;
  v_unpaid numeric; v_carried numeric; v_prepaid numeric; v_new_paid numeric; v_used integer; v_key text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'renew_client_package: not authorized';
  END IF;
  IF p_client_id IS NULL THEN RAISE EXCEPTION 'renew_client_package: client_id required'; END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'renew_client_package: client % not found', p_client_id; END IF;

  v_key := coalesce(p_start_date::text,'-') || '|' || coalesce(p_total_visits,0) || '|' || coalesce(p_price,0);
  IF c.last_renewal_key = v_key THEN
    RAISE EXCEPTION 'This renewal was already activated. Use Undo renewal to correct a mistake.';
  END IF;
  IF p_start_date IS NOT NULL AND c.package_start_date IS NOT NULL AND p_start_date <= c.package_start_date THEN
    RAISE EXCEPTION 'The current package already starts on % — a renewal must start after it. Use Undo renewal to correct a mistake.', c.package_start_date;
  END IF;

  v_unpaid := GREATEST(0, COALESCE(c.package_price, 0) - COALESCE(c.amount_paid, 0));
  v_carried := COALESCE(c.previous_package_owed, 0) + v_unpaid;
  v_prepaid := COALESCE(c.pending_renewal_paid, 0);
  v_new_paid := v_prepaid + GREATEST(0, COALESCE(p_extra_paid, 0));
  v_used := GREATEST(0, LEAST(COALESCE(p_visits_used, 0), COALESCE(p_total_visits, 0)));

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'package_completed',
    'Package completed: "' || COALESCE(c.package_name, '—') || '" (' || COALESCE(c.visits_used, 0) || '/' || COALESCE(c.package_total_visits, 0) || ' visits)',
    jsonb_build_object('package_name', c.package_name, 'package_total_visits', c.package_total_visits, 'package_start_date', c.package_start_date,
      'visits_used', COALESCE(c.visits_used, 0), 'package_price', COALESCE(c.package_price, 0), 'amount_paid', COALESCE(c.amount_paid, 0),
      'unpaid_carried_forward', v_unpaid, 'prepaid_applied_to_next_package', v_prepaid));

  UPDATE public.clients SET visits_used = 0, amount_paid = 0, previous_package_owed = v_carried WHERE id = p_client_id;

  UPDATE public.clients
     SET package_name = p_package_name, package_total_visits = COALESCE(p_total_visits, 0), package_price = COALESCE(p_price, 0),
         package_start_date = p_start_date, amount_paid = v_new_paid, visits_used = v_used,
         next_package_price = NULL, pending_renewal_start_date = NULL, pending_renewal_price = NULL,
         pending_renewal_total_visits = NULL, pending_renewal_package_name = NULL, pending_renewal_created_at = NULL,
         pending_renewal_paid = 0, last_renewal_key = v_key
   WHERE id = p_client_id;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (p_client_id, 'renewal',
    CASE WHEN p_source = 'pre_renewal_activation' THEN 'Package renewed (pre-renewal activated): "'
         WHEN p_source = 'boundary_activation' THEN 'Package renewed (Square showed new package began): "'
         ELSE 'Package renewed: "' END
      || COALESCE(p_package_name, '—') || '" (' || COALESCE(p_total_visits, 0) || ' visits, $' || to_char(COALESCE(p_price, 0), 'FM999999990.00') || ')',
    jsonb_build_object('source', p_source, 'package_name', p_package_name, 'package_total_visits', COALESCE(p_total_visits, 0),
      'package_price', COALESCE(p_price, 0), 'package_start_date', p_start_date, 'amount_paid', v_new_paid,
      'prepaid_applied', v_prepaid, 'unpaid_carried_forward', v_unpaid, 'visits_used_at_activation', v_used, 'renewal_key', v_key)
    || CASE WHEN p_booking_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('booking_id', p_booking_id) END);

  previous_package_owed := v_carried; amount_paid := v_new_paid; prepaid_applied := v_prepaid; unpaid_carried_forward := v_unpaid;
  RETURN NEXT;
END;
$function$;
