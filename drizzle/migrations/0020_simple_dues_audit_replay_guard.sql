DROP TRIGGER simple_package_audit ON public.simple_packages;
CREATE FUNCTION public.simple_package_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid(); NEW.created_at:=now(); ELSE
 NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.client_id:=OLD.client_id; NEW.source:=OLD.source; NEW.square_payment_id:=OLD.square_payment_id;
 IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Removed simple packages cannot be edited'; END IF;
 IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN NEW.reviewed_at:=now(); NEW.reviewed_by:=auth.uid(); END IF;
 END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.simple_package_stamp() FROM PUBLIC;
CREATE TRIGGER simple_package_stamp BEFORE INSERT OR UPDATE ON public.simple_packages FOR EACH ROW EXECUTE FUNCTION public.simple_package_stamp();
CREATE OR REPLACE FUNCTION public.simple_package_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 INSERT INTO public.client_activities(client_id,activity_type,description,metadata) VALUES(NEW.client_id,'simple_package_'||CASE WHEN TG_OP='INSERT' THEN 'added' WHEN NEW.deleted_at IS NOT NULL THEN 'removed' WHEN NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN 'reviewed' ELSE 'edited' END,'Simple dues package '||lower(TG_OP),jsonb_build_object('actor_id',auth.uid(),'before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,'after',to_jsonb(NEW)));
 RETURN NEW; END $$;
CREATE TRIGGER simple_package_audit AFTER INSERT OR UPDATE ON public.simple_packages FOR EACH ROW EXECUTE FUNCTION public.simple_package_audit();