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
  v_pending_price numeric;
  v_unallocated numeric := 0;
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

  SELECT amount_paid, previous_package_owed, package_price, pending_renewal_paid, pending_renewal_start_date, pending_renewal_price
    INTO v_current_paid, v_prev_owed, v_price, v_pending_paid, v_pending_start, v_pending_price
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

  -- 3) No general credit. Money moves forward only into an already-prepared,
  --    priced renewal, and only up to that renewal's open price. Anything else
  --    stays recorded on the current package as an overpayment (never lost) and
  --    is flagged for Payment Review by the callers.
  IF v_remaining > 0 AND v_pending_start IS NOT NULL THEN
    v_to_pending := LEAST(v_remaining, GREATEST(0, COALESCE(v_pending_price, 0) - v_pending_paid));
    v_remaining := v_remaining - v_to_pending;
  END IF;
  IF v_remaining > 0 THEN
    v_unallocated := v_remaining;
    v_to_current := v_to_current + v_remaining;
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
    'match_method', p_match_method,
    'unallocated_excess', v_unallocated,
    'needs_payment_review', v_unallocated > 0
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

