CREATE TABLE public.scheduling_push_runs (id boolean PRIMARY KEY DEFAULT true CHECK(id), token uuid NOT NULL, expires_at timestamptz NOT NULL);
GRANT ALL ON public.scheduling_push_runs TO service_role;
ALTER TABLE public.scheduling_push_runs ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.acquire_scheduling_push_run(p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE acquired boolean;
BEGIN
 INSERT INTO public.scheduling_push_runs(id,token,expires_at) VALUES(true,p_token,now()+interval '5 minutes')
 ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE scheduling_push_runs.expires_at<now() RETURNING true INTO acquired;
 RETURN coalesce(acquired,false);
END $$;
REVOKE ALL ON FUNCTION public.acquire_scheduling_push_run(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_scheduling_push_run(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.release_scheduling_push_run(p_token uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.scheduling_push_runs SET expires_at=now() WHERE id=true AND token=p_token;
$$;
REVOKE ALL ON FUNCTION public.release_scheduling_push_run(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_scheduling_push_run(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.register_scheduling_push_device(p_endpoint text,p_p256dh text,p_auth text,p_origin text,p_label text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old public.scheduling_push_devices; v_id uuid;
BEGIN
 IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('push-device:'||auth.uid()::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('push-endpoint:'||p_endpoint,0));
 IF p_origin<>'https://fbt-admin-ops-portal.lovable.app' OR length(p_label) NOT BETWEEN 1 AND 80 OR length(p_endpoint)>2048 OR p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com)/' OR p_p256dh !~ '^[A-Za-z0-9_-]{87}$' OR p_auth !~ '^[A-Za-z0-9_-]{22}$' THEN RAISE EXCEPTION 'Invalid subscription'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.scheduling_push_secrets) THEN RAISE EXCEPTION 'Push keys unavailable'; END IF;
 SELECT * INTO v_old FROM public.scheduling_push_devices WHERE endpoint=p_endpoint FOR UPDATE;
 IF FOUND AND v_old.user_id<>auth.uid() THEN RAISE EXCEPTION 'Device registered to another account'; END IF;
 IF v_old.id IS NULL AND (SELECT count(*) FROM public.scheduling_push_devices WHERE user_id=auth.uid())>=10 THEN RAISE EXCEPTION 'Device limit reached'; END IF;
 INSERT INTO public.scheduling_push_devices(user_id,endpoint,p256dh,auth_key,origin,label) VALUES(auth.uid(),p_endpoint,p_p256dh,p_auth,p_origin,p_label)
 ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth_key=excluded.auth_key,label=excluded.label,enabled=true,last_error=NULL,updated_at=now() WHERE scheduling_push_devices.user_id=auth.uid() RETURNING id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Device unavailable'; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_scheduling_push_device(text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_scheduling_push_device(text,text,text,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.claim_scheduling_push_test(p_user uuid,p_device uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('push-test:'||p_user::text,0));
 IF NOT public.is_staff(p_user) OR NOT EXISTS(SELECT 1 FROM public.scheduling_push_devices WHERE id=p_device AND user_id=p_user AND enabled) THEN RAISE EXCEPTION 'Device unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.scheduling_push_attempts WHERE recipient_id=p_user AND kind='test' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Wait one minute before another test'; END IF;
 INSERT INTO public.scheduling_push_attempts(recipient_id,device_id,kind) VALUES(p_user,p_device,'test') RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_scheduling_push_test(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduling_push_test(uuid,uuid) TO service_role;