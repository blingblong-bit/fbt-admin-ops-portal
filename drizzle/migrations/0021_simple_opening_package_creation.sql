CREATE UNIQUE INDEX simple_one_opening_per_client ON public.simple_packages(client_id) WHERE source='opening';
CREATE FUNCTION public.simple_create_opening_packages(_cutover date,_expected jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE planned jsonb; inserted integer;
BEGIN
 IF NOT(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) THEN RAISE EXCEPTION 'Admin required'; END IF;
 IF _cutover IS NULL OR jsonb_typeof(_expected)<>'array' THEN RAISE EXCEPTION 'Preview required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('simple_create_opening_packages'));
 -- Stabilize read-only source evidence until this action completes. No source rows are modified.
 LOCK TABLE public.clients,public.package_overrides IN SHARE MODE;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('client_id',id,'visits',visits,'price',price,'started_on',started_on) ORDER BY id),'[]'::jsonb) INTO planned
 FROM (
 SELECT c.id,COALESCE(o.total_visits,c.package_total_visits) AS visits,COALESCE(o.price,c.package_price) AS price,COALESCE(o.start_date,c.package_start_date) AS started_on
 FROM public.clients c LEFT JOIN LATERAL (SELECT * FROM public.package_overrides p WHERE p.client_id=c.id AND p.slot='current' AND p.cleared_at IS NULL ORDER BY p.created_at DESC,p.id DESC LIMIT 1) o ON true
 WHERE c.status='active' AND c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.simple_packages s WHERE s.client_id=c.id AND s.source='opening')
 ) effective WHERE visits>0 AND started_on IS NOT NULL AND started_on<_cutover;
 IF planned IS DISTINCT FROM _expected THEN RAISE EXCEPTION 'Package info changed. Refresh the preview before creating opening packages.'; END IF;
 INSERT INTO public.simple_packages(client_id,visits,price,started_on,source,note,created_by)
 SELECT client_id,visits,price,started_on,'opening','Opening package snapshot; excluded from simple balance',auth.uid() FROM jsonb_to_recordset(planned) AS r(client_id uuid,visits integer,price numeric,started_on date)
 ON CONFLICT(client_id) WHERE source='opening' DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.simple_create_opening_packages(date,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.simple_create_opening_packages(date,jsonb) TO authenticated;