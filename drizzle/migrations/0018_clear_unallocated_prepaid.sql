CREATE OR REPLACE FUNCTION public.clear_unallocated_prepaid(p_client_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.clients%ROWTYPE;
  v_amt numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can clear paid-ahead money'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  v_amt := coalesce(c.pending_renewal_paid, 0);
  IF v_amt <= 0 AND c.pending_renewal_start_date IS NULL THEN RETURN jsonb_build_object('changed', false); END IF;

  UPDATE public.clients SET pending_renewal_paid = 0, pending_renewal_start_date = NULL, pending_renewal_price = NULL,
    pending_renewal_total_visits = NULL, pending_renewal_package_name = NULL, pending_renewal_created_at = NULL
  WHERE id = p_client_id;

  -- Keep later-payment math on active corrections unchanged: shift their
  -- paid-ahead baseline by the cleared amount so already-counted payments stay counted.
  UPDATE public.package_overrides
     SET raw_baseline = jsonb_set(raw_baseline, '{pending_paid}', to_jsonb(coalesce((raw_baseline->>'pending_paid')::numeric, 0) - v_amt))
   WHERE client_id = p_client_id AND cleared_at IS NULL AND raw_baseline IS NOT NULL;

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata) VALUES (
    p_client_id, 'edit',
    'Cleared old paid-ahead $' || to_char(v_amt, 'FM999999990.00') || ' and prepared renewal — ' || p_reason,
    jsonb_build_object('kind', 'clear_unallocated_prepaid', 'money_changed', true, 'actor', auth.uid(), 'reason', p_reason,
      'before', jsonb_build_object('pending_renewal_paid', c.pending_renewal_paid, 'pending_renewal_start_date', c.pending_renewal_start_date,
        'pending_renewal_price', c.pending_renewal_price, 'pending_renewal_total_visits', c.pending_renewal_total_visits)));
  RETURN jsonb_build_object('changed', true, 'cleared', v_amt);
END $function$;

REVOKE ALL ON FUNCTION public.clear_unallocated_prepaid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_unallocated_prepaid(uuid, text) TO authenticated, service_role;