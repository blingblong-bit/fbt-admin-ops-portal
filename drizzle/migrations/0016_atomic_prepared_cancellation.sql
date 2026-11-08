CREATE OR REPLACE FUNCTION public.cancel_prepared_renewal(p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.clients; o public.package_overrides; v_actor uuid := auth.uid(); v_changed boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_staff(v_actor) THEN RAISE EXCEPTION 'Only staff can cancel prepared renewals.'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  SELECT * INTO o FROM public.package_overrides WHERE client_id=p_client_id AND slot='pending' AND cleared_at IS NULL FOR UPDATE;
  IF o.id IS NOT NULL AND NOT public.is_admin(v_actor) THEN RAISE EXCEPTION 'An admin must cancel this corrected renewal.'; END IF;
  IF o.id IS NOT NULL AND o.status <> 'prepared' THEN RAISE EXCEPTION 'This corrected package has already started. Use audited package correction instead of cancellation.'; END IF;
  IF COALESCE(c.pending_renewal_paid,0) > 0 OR (c.pending_renewal_start_date IS NOT NULL AND COALESCE(o.recognized_paid,0)>0) THEN
    RAISE EXCEPTION 'This renewal has prepaid funds. Open the client package correction and payment reconciliation controls before cancelling; no money was moved.';
  END IF;
  v_changed := c.pending_renewal_start_date IS NOT NULL OR c.pending_renewal_price IS NOT NULL OR c.pending_renewal_total_visits IS NOT NULL OR c.pending_renewal_package_name IS NOT NULL OR c.pending_renewal_created_at IS NOT NULL OR o.id IS NOT NULL;
  IF NOT v_changed THEN RETURN jsonb_build_object('ok',true,'changed',false,'movedToCurrent',0); END IF;
  UPDATE public.clients SET pending_renewal_start_date=NULL,pending_renewal_price=NULL,pending_renewal_total_visits=NULL,pending_renewal_package_name=NULL,pending_renewal_created_at=NULL WHERE id=p_client_id;
  IF o.id IS NOT NULL THEN
    UPDATE public.package_overrides SET cleared_at=now(),cleared_by=v_actor,clear_reason='Prepared renewal cancelled by owner/staff request; current package and payment history unchanged.' WHERE id=o.id;
  END IF;
  INSERT INTO public.client_activities(client_id,activity_type,description,metadata)
  VALUES(p_client_id,'pre_renewal_cancelled','Prepared renewal cancelled, including its prepared correction. Current package and payment history unchanged.',jsonb_build_object('actor',v_actor,'money_changed',false,'before_prepared',jsonb_build_object('start_date',c.pending_renewal_start_date,'price',c.pending_renewal_price,'total_visits',c.pending_renewal_total_visits,'recognized_paid',c.pending_renewal_paid),'cleared_override',CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END,'after_prepared',NULL));
  RETURN jsonb_build_object('ok',true,'changed',true,'movedToCurrent',0);
END $$;
REVOKE ALL ON FUNCTION public.cancel_prepared_renewal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_prepared_renewal(uuid) TO authenticated;