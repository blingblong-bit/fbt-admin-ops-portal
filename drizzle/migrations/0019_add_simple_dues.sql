CREATE TABLE public.simple_packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id), visits integer NOT NULL CHECK(visits>=0), price numeric(12,2) NOT NULL CHECK(price>=0), started_on date NOT NULL, source text NOT NULL CHECK(source IN ('auto','manual','opening')), square_payment_id text UNIQUE, flagged_for_review boolean NOT NULL DEFAULT false, reviewed_at timestamptz, reviewed_by uuid REFERENCES auth.users(id), note text, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
GRANT SELECT,INSERT,UPDATE ON public.simple_packages TO authenticated; GRANT ALL ON public.simple_packages TO service_role;
ALTER TABLE public.simple_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY simple_packages_read ON public.simple_packages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('staff','moderator','admin','superadmin')));
CREATE POLICY simple_packages_admin ON public.simple_packages FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE INDEX simple_packages_client_start ON public.simple_packages(client_id,started_on);
CREATE TABLE public.simple_opening_balances (client_id uuid PRIMARY KEY REFERENCES public.clients(id), amount numeric(12,2) NOT NULL, as_of date NOT NULL, note text, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE ON public.simple_opening_balances TO authenticated; GRANT ALL ON public.simple_opening_balances TO service_role;
ALTER TABLE public.simple_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY simple_openings_read ON public.simple_opening_balances FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('staff','moderator','admin','superadmin')));
CREATE POLICY simple_openings_admin ON public.simple_opening_balances FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE TABLE public.simple_price_list (amount numeric(12,2) PRIMARY KEY CHECK(amount>0), visits integer NOT NULL CHECK(visits>0), flag_for_review boolean NOT NULL DEFAULT false);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.simple_price_list TO authenticated; GRANT ALL ON public.simple_price_list TO service_role;
ALTER TABLE public.simple_price_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY simple_prices_read ON public.simple_price_list FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('staff','moderator','admin','superadmin')));
CREATE POLICY simple_prices_admin ON public.simple_price_list FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE TABLE public.simple_dues_settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), cutover_date date);
GRANT SELECT,INSERT,UPDATE ON public.simple_dues_settings TO authenticated; GRANT ALL ON public.simple_dues_settings TO service_role;
ALTER TABLE public.simple_dues_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY simple_settings_read ON public.simple_dues_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('staff','moderator','admin','superadmin')));
CREATE POLICY simple_settings_admin ON public.simple_dues_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));
CREATE FUNCTION public.simple_package_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); NEW.created_at:=now();
 ELSE NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.client_id:=OLD.client_id; NEW.source:=OLD.source; NEW.square_payment_id:=OLD.square_payment_id;
 IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Removed simple packages cannot be edited'; END IF;
 IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN NEW.reviewed_at:=now(); NEW.reviewed_by:=auth.uid(); END IF;
 END IF;
 INSERT INTO public.client_activities(client_id,activity_type,description,metadata) VALUES(NEW.client_id,'simple_package_'||CASE WHEN TG_OP='INSERT' THEN 'added' WHEN NEW.deleted_at IS NOT NULL THEN 'removed' WHEN NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN 'reviewed' ELSE 'edited' END,'Simple dues package '||lower(TG_OP),jsonb_build_object('actor_id',auth.uid(),'before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,'after',to_jsonb(NEW)));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.simple_package_audit() FROM PUBLIC;
CREATE TRIGGER simple_package_audit BEFORE INSERT OR UPDATE ON public.simple_packages FOR EACH ROW EXECUTE FUNCTION public.simple_package_audit();
CREATE FUNCTION public.simple_opening_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); NEW.created_at:=now(); ELSE NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.simple_opening_stamp() FROM PUBLIC;
CREATE TRIGGER simple_opening_stamp BEFORE INSERT OR UPDATE ON public.simple_opening_balances FOR EACH ROW EXECUTE FUNCTION public.simple_opening_stamp();
CREATE FUNCTION public.simple_record_payment(_payment_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.square_payments; c date; d date; pricing public.simple_price_list;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) THEN RAISE EXCEPTION 'Admin required'; END IF;
 SELECT cutover_date INTO c FROM public.simple_dues_settings WHERE id=true;
 IF c IS NULL THEN RETURN 'inactive'; END IF;
 SELECT * INTO p FROM public.square_payments WHERE square_payment_id=_payment_id;
 IF NOT FOUND OR p.status<>'COMPLETED' OR p.currency<>'USD' OR p.client_id IS NULL THEN RETURN 'ignored'; END IF;
 d:=COALESCE(NULLIF(p.raw_event#>>'{data,object,payment,created_at}','')::timestamptz,p.created_at) AT TIME ZONE 'America/Chicago';
 IF d<c THEN RETURN 'before_cutover'; END IF;
 SELECT * INTO pricing FROM public.simple_price_list WHERE amount=p.amount_cents::numeric/100;
 IF NOT FOUND THEN RETURN 'check_package_info'; END IF;
 INSERT INTO public.simple_packages(client_id,visits,price,started_on,source,square_payment_id,flagged_for_review)
 VALUES(p.client_id,pricing.visits,p.amount_cents::numeric/100,d,'auto',p.square_payment_id,pricing.flag_for_review) ON CONFLICT(square_payment_id) DO NOTHING;
 RETURN 'recorded';
END $$;
REVOKE ALL ON FUNCTION public.simple_record_payment(text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.simple_record_payment(text) TO authenticated,service_role;
CREATE FUNCTION public.simple_import_openings(_rows jsonb,_as_of date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; n integer:=0;
BEGIN
 IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) THEN RAISE EXCEPTION 'Admin required'; END IF;
 IF jsonb_typeof(_rows)<>'array' OR jsonb_array_length(_rows)>5000 THEN RAISE EXCEPTION 'Invalid import'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
 INSERT INTO public.simple_opening_balances(client_id,amount,as_of,note,created_by) VALUES((r->>'client_id')::uuid,(r->>'amount')::numeric,_as_of,r->>'note',auth.uid()) ON CONFLICT(client_id) DO UPDATE SET amount=EXCLUDED.amount,as_of=EXCLUDED.as_of,note=EXCLUDED.note;
 n:=n+1;
 END LOOP; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.simple_import_openings(jsonb,date) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.simple_import_openings(jsonb,date) TO authenticated;
CREATE FUNCTION public.simple_payment_note(_client_id uuid,_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin')) THEN RAISE EXCEPTION 'Admin required'; END IF;
 IF length(trim(_note))=0 OR length(_note)>2000 THEN RAISE EXCEPTION 'Note required, maximum 2000 characters'; END IF;
 INSERT INTO public.client_activities(client_id,activity_type,description,metadata) VALUES(_client_id,'simple_payment_note',_note,jsonb_build_object('actor_id',auth.uid(),'informational_only',true));
END $$;
REVOKE ALL ON FUNCTION public.simple_payment_note(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.simple_payment_note(uuid,text) TO authenticated;