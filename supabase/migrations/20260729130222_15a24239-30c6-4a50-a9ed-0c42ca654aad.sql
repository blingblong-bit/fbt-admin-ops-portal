CREATE OR REPLACE FUNCTION public.clients_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.visits_used < 0 THEN NEW.visits_used := 0; END IF;
  IF NEW.amount_paid < 0 THEN NEW.amount_paid := 0; END IF;
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
  v_amount_dollars numeric;
  v_new_paid numeric;
  v_applied numeric;
  v_metadata jsonb;
BEGIN
  IF p_client_id IS NULL OR p_square_payment_id IS NULL OR p_amount_cents IS NULL THEN
    RAISE EXCEPTION 'apply_square_payment: null argument (client_id/square_payment_id/amount_cents required)';
  END IF;

  v_amount_dollars := (p_amount_cents::numeric) / 100.0;

  SELECT amount_paid INTO v_current_paid
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

  -- No cap: amount_paid always reflects the true full sum Square processed.
  v_new_paid := v_current_paid + v_amount_dollars;
  v_applied := v_amount_dollars;

  UPDATE public.clients
     SET amount_paid = v_new_paid
   WHERE id = p_client_id;

  v_metadata := jsonb_build_object(
    'source', 'square',
    'square_payment_id', p_square_payment_id,
    'amount', v_amount_dollars,
    'applied_amount', v_applied,
    'match_method', p_match_method
  );
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
  applied_amount := v_applied;
  RETURN NEXT;
END;
$function$;