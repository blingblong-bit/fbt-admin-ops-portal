DROP FUNCTION IF EXISTS public.renew_client_package(uuid, text, integer, numeric, date, numeric, text, text);

CREATE FUNCTION public.renew_client_package(p_client_id uuid, p_package_name text, p_total_visits integer, p_price numeric, p_start_date date, p_extra_paid numeric DEFAULT 0, p_source text DEFAULT 'manual_renewal'::text, p_booking_id text DEFAULT NULL::text, p_visits_used integer DEFAULT 0)
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
  v_used integer;
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
  v_used := GREATEST(0, LEAST(COALESCE(p_visits_used, 0), COALESCE(p_total_visits, 0)));

  INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
  VALUES (
    p_client_id,
    'package_completed',
    'Package completed: "' || COALESCE(c.package_name, '—') || '" (' ||
      COALESCE(c.visits_used, 0) || '/' || COALESCE(c.package_total_visits, 0) || ' visits)',
    jsonb_build_object(
      'package_name', c.package_name,
      'package_total_visits', c.package_total_visits,
      'package_start_date', c.package_start_date,
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
         visits_used = v_used,
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
      WHEN p_source = 'boundary_activation'
      THEN 'Package renewed (Square showed new package began): "'
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
      'unpaid_carried_forward', v_unpaid,
      'visits_used_at_activation', v_used
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

GRANT EXECUTE ON FUNCTION public.renew_client_package(uuid, text, integer, numeric, date, numeric, text, text, integer) TO authenticated, service_role;