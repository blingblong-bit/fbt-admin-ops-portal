CREATE TABLE public.scheduling_push_config (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), scheduler_id uuid, enabled boolean NOT NULL DEFAULT false,
 reminder_start time, reminder_end time, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
 CHECK (NOT enabled OR (scheduler_id IS NOT NULL AND reminder_start IS NOT NULL AND reminder_end IS NOT NULL AND reminder_start < reminder_end))
);
GRANT SELECT ON public.scheduling_push_config TO authenticated;
GRANT ALL ON public.scheduling_push_config TO service_role;
ALTER TABLE public.scheduling_push_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_config_staff_read ON public.scheduling_push_config FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE TABLE public.scheduling_push_secrets (id boolean PRIMARY KEY DEFAULT true CHECK(id), public_key text NOT NULL, encrypted_private_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.scheduling_push_secrets TO service_role;
ALTER TABLE public.scheduling_push_secrets ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.scheduling_push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, endpoint text NOT NULL UNIQUE,
 p256dh text NOT NULL, auth_key text NOT NULL, origin text NOT NULL, label text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_error text
);
GRANT SELECT ON public.scheduling_push_devices TO authenticated;
GRANT ALL ON public.scheduling_push_devices TO service_role;
ALTER TABLE public.scheduling_push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_devices_own_read ON public.scheduling_push_devices FOR SELECT TO authenticated USING (user_id=auth.uid() AND public.is_staff(auth.uid()));
CREATE TABLE public.scheduling_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id), owner_id uuid NOT NULL,
 due_at timestamptz NOT NULL, context text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 outcome text, completed_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='open' AND completed_at IS NULL) OR (status='completed' AND completed_at IS NOT NULL AND length(trim(outcome))>0))
);
GRANT SELECT ON public.scheduling_followups TO authenticated;
GRANT ALL ON public.scheduling_followups TO service_role;
ALTER TABLE public.scheduling_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY followups_staff_read ON public.scheduling_followups FOR SELECT TO authenticated USING(public.is_staff(auth.uid()));
CREATE INDEX scheduling_followups_due ON public.scheduling_followups(owner_id,due_at) WHERE status='open';
CREATE TABLE public.scheduling_followup_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES public.scheduling_followups(id) ON DELETE CASCADE,
 actor uuid NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scheduling_followup_events TO authenticated;
GRANT ALL ON public.scheduling_followup_events TO service_role;
ALTER TABLE public.scheduling_followup_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY followup_events_staff_read ON public.scheduling_followup_events FOR SELECT TO authenticated USING(public.is_staff(auth.uid()));
CREATE TABLE public.scheduling_push_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES public.scheduling_followups(id) ON DELETE CASCADE,
 revision integer, device_id uuid REFERENCES public.scheduling_push_devices(id) ON DELETE SET NULL,
 recipient_id uuid NOT NULL, reminder_day date, kind text NOT NULL CHECK(kind IN ('task','test')),
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','accepted','failed','expired','suppressed')),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(task_id,revision,device_id,reminder_day)
);
GRANT SELECT ON public.scheduling_push_attempts TO authenticated;
GRANT ALL ON public.scheduling_push_attempts TO service_role;
ALTER TABLE public.scheduling_push_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_attempts_own_or_admin_read ON public.scheduling_push_attempts FOR SELECT TO authenticated USING(public.is_staff(auth.uid()) AND (recipient_id=auth.uid() OR public.is_admin(auth.uid())));
CREATE OR REPLACE FUNCTION public.configure_scheduling_push(p_scheduler uuid, p_enabled boolean, p_start time, p_end time) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF p_scheduler IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_scheduler AND role='staff') OR public.is_admin(p_scheduler)) THEN RAISE EXCEPTION 'Select an existing staff scheduler, not an owner/admin'; END IF;
 IF p_enabled AND NOT EXISTS(SELECT 1 FROM public.scheduling_push_devices WHERE user_id=p_scheduler AND enabled) THEN RAISE EXCEPTION 'Scheduler must enable a device first'; END IF;
 INSERT INTO public.scheduling_push_config(id,scheduler_id,enabled,reminder_start,reminder_end,updated_by) VALUES(true,p_scheduler,p_enabled,p_start,p_end,auth.uid())
 ON CONFLICT(id) DO UPDATE SET scheduler_id=excluded.scheduler_id,enabled=excluded.enabled,reminder_start=excluded.reminder_start,reminder_end=excluded.reminder_end,updated_at=now(),updated_by=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.configure_scheduling_push(uuid,boolean,time,time) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_scheduling_push(uuid,boolean,time,time) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_scheduling_followup(p_id uuid,p_client uuid,p_owner uuid,p_due timestamptz,p_context text,p_outcome text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_old public.scheduling_followups;
BEGIN
 IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF p_id IS NULL THEN
  IF p_due IS NULL OR p_context IS NULL OR length(trim(p_context)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Explicit due time and context required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_owner AND role='staff') OR public.is_admin(p_owner) THEN RAISE EXCEPTION 'Select an existing staff account'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Client unavailable'; END IF;
  INSERT INTO public.scheduling_followups(client_id,owner_id,due_at,context,created_by) VALUES(p_client,p_owner,p_due,trim(p_context),auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.scheduling_followup_events(task_id,actor,action,details) VALUES(v_id,auth.uid(),'created',jsonb_build_object('owner_id',p_owner,'due_at',p_due));
 ELSE
  SELECT * INTO v_old FROM public.scheduling_followups WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR (v_old.owner_id<>auth.uid() AND v_old.created_by<>auth.uid() AND NOT public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF v_old.status<>'open' THEN RETURN p_id; END IF;
  IF p_outcome IS NOT NULL THEN
   IF length(trim(p_outcome)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Outcome required'; END IF;
   UPDATE public.scheduling_followups SET status='completed',outcome=trim(p_outcome),completed_at=now(),revision=revision+1,updated_at=now() WHERE id=p_id;
   INSERT INTO public.scheduling_followup_events(task_id,actor,action,details) VALUES(p_id,auth.uid(),'completed',jsonb_build_object('outcome',trim(p_outcome)));
  ELSE
   IF p_due IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_owner AND role='staff') OR public.is_admin(p_owner) THEN RAISE EXCEPTION 'Owner and explicit due time required'; END IF;
   UPDATE public.scheduling_followups SET owner_id=p_owner,due_at=p_due,revision=revision+1,updated_at=now() WHERE id=p_id;
   INSERT INTO public.scheduling_followup_events(task_id,actor,action,details) VALUES(p_id,auth.uid(),'reassigned',jsonb_build_object('owner_id',p_owner,'due_at',p_due));
  END IF;
  v_id:=p_id;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_scheduling_followup(uuid,uuid,uuid,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_scheduling_followup(uuid,uuid,uuid,timestamptz,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.claim_scheduling_push(p_origin text) RETURNS SETOF public.scheduling_push_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg public.scheduling_push_config; local_now timestamp;
BEGIN
 IF NOT pg_try_advisory_xact_lock(812673991) THEN RETURN; END IF;
 SELECT * INTO cfg FROM public.scheduling_push_config WHERE id=true;
 local_now:=now() AT TIME ZONE 'America/Chicago';
 IF NOT FOUND OR NOT cfg.enabled OR cfg.scheduler_id IS NULL OR cfg.reminder_start IS NULL OR cfg.reminder_end IS NULL OR local_now::time<cfg.reminder_start OR local_now::time>=cfg.reminder_end THEN RETURN; END IF;
 IF public.is_admin(cfg.scheduler_id) OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=cfg.scheduler_id AND role='staff') THEN RETURN; END IF;
 RETURN QUERY INSERT INTO public.scheduling_push_attempts(task_id,revision,device_id,recipient_id,reminder_day,kind)
 SELECT t.id,t.revision,d.id,t.owner_id,local_now::date,'task'
 FROM public.scheduling_followups t JOIN public.scheduling_push_devices d ON d.user_id=t.owner_id AND d.enabled AND d.origin=p_origin
 JOIN public.clients c ON c.id=t.client_id AND c.deleted_at IS NULL
 WHERE t.owner_id=cfg.scheduler_id AND t.status='open' AND t.due_at<=now()
 AND NOT EXISTS(SELECT 1 FROM public.scheduling_push_attempts a WHERE a.task_id=t.id AND a.revision=t.revision AND a.device_id=d.id AND a.reminder_day=local_now::date)
 ORDER BY t.due_at,t.id LIMIT 20 ON CONFLICT DO NOTHING RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_scheduling_push(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduling_push(text) TO service_role;
COMMENT ON TABLE public.scheduling_push_secrets IS 'Server-only encrypted VAPID private key. No browser grants or policies.';
COMMENT ON TABLE public.scheduling_push_attempts IS 'Push service acceptance is not device delivery. Unique task revision/device/Chicago day; claimed uncertain attempts are not automatically retried.';