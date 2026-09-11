ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS pending_renewal_paid numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.clients_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.visits_used < 0 THEN NEW.visits_used := 0; END IF;
  IF NEW.amount_paid < 0 THEN NEW.amount_paid := 0; END IF;
  IF NEW.previous_package_owed IS NULL OR NEW.previous_package_owed < 0 THEN
    NEW.previous_package_owed := 0;
  END IF;
  IF NEW.pending_renewal_paid IS NULL OR NEW.pending_renewal_paid < 0 THEN
    NEW.pending_renewal_paid := 0;
  END IF;
  IF NEW.visits_used > NEW.package_total_visits THEN
    RAISE EXCEPTION 'visits_used (%) cannot exceed package_total_visits (%)', NEW.visits_used, NEW.package_total_visits;
  END IF;
  -- amount_paid is intentionally NOT capped at package_price: it must reflect
  -- the true total Square processed. Overpayment is a signal, not an error.
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_square_payment(p_client_id uuid, p_square_payment_id text, p_amount_cents integer, p_match_method text, p_manual_resolution boolean DEFAULT false)
 RETURNS TABLE(newly_applied boolean, applied_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
  v_current_paid numeric;
  v_prev_owed numeric;
  v_price numeric;
  v_pending_paid numeric;
  v_pending_start date;
  v_amount_dollars numeric;
  v_remaining numeric;
  v_to_prev numeric;
  v_to_current numeric;
  v_to_pending numeric;
  v_current_capacity numeric;
  v_metadata jsonb;
BEGIN
  IF p_client_id IS NULL OR p_square_payment_id IS NULL OR p_amount_cents IS NULL THEN
    RAISE EXCEPTION 'apply_square_payment: null argument (client_id/square_payment_id/amount_cents required)';
  END IF;

  v_amount_dollars := (p_amount_cents::numeric) / 100.0;

  SELECT amount_paid, previous_package_owed, package_price, pending_renewal_paid, pending_renewal_start_date
    INTO v_current_paid, v_prev_owed, v_price, v_pending_paid, v_pending_start
  FROM public.clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_square_payment: client % not found', p_client_id;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.client_activities
  WHERE client_id = p_client_id
    AND metadata @> jsonb_build_object('square_payment_id', p_square_payment_id)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    newly_applied := false;
    applied_amount := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  v_current_paid := COALESCE(v_current_paid, 0);
  v_prev_owed := COALESCE(v_prev_owed, 0);
  v_price := COALESCE(v_price, 0);
  v_pending_paid := COALESCE(v_pending_paid, 0);

  -- 1) Oldest debt first: pay down the previous package.
  v_to_prev := LEAST(v_prev_owed, v_amount_dollars);
  v_remaining := v_amount_dollars - v_to_prev;

  -- 2) Then the balance still open on the current package.
  v_current_capacity := GREATEST(0, v_price - v_current_paid);
  v_to_current := LEAST(v_current_capacity, v_remaining);
  v_remaining := v_remaining - v_to_current;
  v_to_pending := 0;

  -- 3) Anything left only moves forward when a prepared renewal explains it.
  --    Otherwise it stays on the current package as a reviewable overpayment;
  --    no general account credit is ever created.
  IF v_remaining > 0 THEN
    IF v_pending_start IS NOT NULL THEN
      v_to_pending := v_remaining;
    ELSE
      v_to_current := v_to_current + v_remaining;
    END IF;
    v_remaining := 0;
  END IF;

  UPDATE public.clients
     SET previous_package_owed = v_prev_owed - v_to_prev,
         amount_paid = v_current_paid + v_to_current,
         pending_renewal_paid = v_pending_paid + v_to_pending
   WHERE id = p_client_id;

  v_metadata := jsonb_build_object(
    'source', 'square',
    'square_payment_id', p_square_payment_id,
    'amount', v_amount_dollars,
    'applied_amount', v_amount_dollars,
    'applied_to_previous_package', v_to_prev,
    'applied_to_current_package', v_to_current,
    'applied_to_pending_package', v_to_pending,
    'match_method', p_match_method
  );
  IF v_to_pending > 0 THEN
    v_metadata := v_metadata || jsonb_build_object(
      'pre_activation', true,
      'pending_package_start_date', v_pending_start
    );
  END IF;
  IF p_manual_resolution THEN
    v_metadata := v_metadata || jsonb_build_object('manual_resolution', true);
  END IF;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (
    p_client_id,
    'payment',
    'Square payment synced — $' || to_char(v_amount_dollars, 'FM999999990.00'),
    v_metadata
  );

  newly_applied := true;
  applied_amount := v_amount_dollars;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.renew_client_package(
  p_client_id uuid,
  p_package_name text,
  p_total_visits integer,
  p_price numeric,
  p_start_date date,
  p_extra_paid numeric DEFAULT 0,
  p_source text DEFAULT 'manual_renewal',
  p_booking_id text DEFAULT NULL
)
 RETURNS TABLE(previous_package_owed numeric, amount_paid numeric, prepaid_applied numeric, unpaid_carried_forward numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.clients%ROWTYPE;
  v_unpaid numeric;
  v_carried numeric;
  v_prepaid numeric;
  v_new_paid numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'renew_client_package: not authorized';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'renew_client_package: client_id required';
  END IF;

  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'renew_client_package: client % not found', p_client_id;
  END IF;

  v_unpaid := GREATEST(0, COALESCE(c.package_price, 0) - COALESCE(c.amount_paid, 0));
  v_carried := COALESCE(c.previous_package_owed, 0) + v_unpaid;
  v_prepaid := COALESCE(c.pending_renewal_paid, 0);
  v_new_paid := v_prepaid + GREATEST(0, COALESCE(p_extra_paid, 0));

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (
    p_client_id,
    'package_completed',
    'Package completed: "' || COALESCE(c.package_name, '—') || '" (' ||
      COALESCE(c.visits_used, 0) || '/' || COALESCE(c.package_total_visits, 0) || ' visits)',
    jsonb_build_object(
      'package_name', c.package_name,
      'package_total_visits', c.package_total_visits,
      'visits_used', COALESCE(c.visits_used, 0),
      'package_price', COALESCE(c.package_price, 0),
      'amount_paid', COALESCE(c.amount_paid, 0),
      'unpaid_carried_forward', v_unpaid,
      'prepaid_applied_to_next_package', v_prepaid
    )
  );

  UPDATE public.clients
     SET visits_used = 0,
         amount_paid = 0,
         previous_package_owed = v_carried
   WHERE id = p_client_id;

  UPDATE public.clients
     SET package_name = p_package_name,
         package_total_visits = COALESCE(p_total_visits, 0),
         package_price = COALESCE(p_price, 0),
         package_start_date = p_start_date,
         amount_paid = v_new_paid,
         next_package_price = NULL,
         pending_renewal_start_date = NULL,
         pending_renewal_price = NULL,
         pending_renewal_total_visits = NULL,
         pending_renewal_package_name = NULL,
         pending_renewal_created_at = NULL,
         pending_renewal_paid = 0
   WHERE id = p_client_id;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (
    p_client_id,
    'renewal',
    CASE WHEN p_source = 'pre_renewal_activation'
      THEN 'Package renewed (pre-renewal activated): "'
      ELSE 'Package renewed: "' END
      || COALESCE(p_package_name, '—') || '" (' || COALESCE(p_total_visits, 0)
      || ' visits, $' || to_char(COALESCE(p_price, 0), 'FM999999990.00') || ')',
    jsonb_build_object(
      'source', p_source,
      'package_name', p_package_name,
      'package_total_visits', COALESCE(p_total_visits, 0),
      'package_price', COALESCE(p_price, 0),
      'package_start_date', p_start_date,
      'amount_paid', v_new_paid,
      'prepaid_applied', v_prepaid,
      'unpaid_carried_forward', v_unpaid
    ) || CASE WHEN p_booking_id IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('booking_id', p_booking_id) END
  );

  previous_package_owed := v_carried;
  amount_paid := v_new_paid;
  prepaid_applied := v_prepaid;
  unpaid_carried_forward := v_unpaid;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_client_package(uuid, text, integer, numeric, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_client_package(uuid, text, integer, numeric, date, numeric, text, text) TO authenticated, service_role;