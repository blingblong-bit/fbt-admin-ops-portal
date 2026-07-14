
-- 1. Add payment_model column
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_model text NOT NULL DEFAULT 'package'
  CHECK (payment_model IN ('package', 'pay_per_visit'));

-- 2. Relax validation trigger so zero-visit clients can exceed package_price
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
  IF NEW.package_total_visits > 0 AND NEW.amount_paid > NEW.package_price THEN
    RAISE EXCEPTION 'amount_paid (%) cannot exceed package_price (%)', NEW.amount_paid, NEW.package_price;
  END IF;
  RETURN NEW;
END; $function$;

-- 3. Remove cap in apply_square_payment when package_total_visits = 0
CREATE OR REPLACE FUNCTION public.apply_square_payment(p_client_id uuid, p_square_payment_id text, p_amount_cents integer, p_match_method text, p_manual_resolution boolean DEFAULT false)
RETURNS TABLE(newly_applied boolean, applied_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
  v_current_paid numeric;
  v_price numeric;
  v_total_visits integer;
  v_amount_dollars numeric;
  v_new_paid numeric;
  v_applied numeric;
  v_metadata jsonb;
BEGIN
  IF p_client_id IS NULL OR p_square_payment_id IS NULL OR p_amount_cents IS NULL THEN
    RAISE EXCEPTION 'apply_square_payment: null argument (client_id/square_payment_id/amount_cents required)';
  END IF;

  v_amount_dollars := (p_amount_cents::numeric) / 100.0;

  SELECT amount_paid, package_price, package_total_visits
    INTO v_current_paid, v_price, v_total_visits
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
  v_price := COALESCE(v_price, 0);
  v_total_visits := COALESCE(v_total_visits, 0);

  -- Cap at package_price only for real packages (total_visits > 0).
  -- Zero-visit clients are treated as uncapped ledgers (per-visit / drop-in).
  IF v_total_visits > 0 AND v_price > 0 THEN
    v_new_paid := LEAST(v_price, v_current_paid + v_amount_dollars);
  ELSE
    v_new_paid := v_current_paid + v_amount_dollars;
  END IF;

  v_applied := GREATEST(0, v_new_paid - v_current_paid);

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

-- 4. Mark Jonathan Owens as pay_per_visit and backfill his dropped payments
UPDATE public.clients
   SET payment_model = 'pay_per_visit',
       amount_paid = 150.00
 WHERE id = 'd8e2310f-595f-4130-b785-479b20b14daf';

-- 5. Fix the two dropped activity rows so their applied_amount reflects reality
UPDATE public.client_activities
   SET metadata = metadata || jsonb_build_object('applied_amount', 50, 'backfilled', true)
 WHERE client_id = 'd8e2310f-595f-4130-b785-479b20b14daf'
   AND activity_type = 'payment'
   AND metadata ? 'square_payment_id'
   AND (metadata->>'applied_amount')::numeric = 0;
