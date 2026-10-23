ALTER TABLE public.package_overrides ADD COLUMN baseline_visits_used integer;
COMMENT ON COLUMN public.package_overrides.baseline_visits_used IS 'Raw clients.visits_used when a current-slot override was set; later check-ins add on top of the admin figure.';
CREATE OR REPLACE FUNCTION public.package_overrides_set_baseline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slot = 'current' AND NEW.baseline_visits_used IS NULL THEN
    SELECT visits_used INTO NEW.baseline_visits_used FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_overrides_baseline BEFORE INSERT ON public.package_overrides FOR EACH ROW EXECUTE FUNCTION public.package_overrides_set_baseline();