
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  package_name TEXT,
  package_total_visits INTEGER NOT NULL DEFAULT 0,
  package_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  package_start_date DATE,
  visits_used INTEGER NOT NULL DEFAULT 0,
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon, authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access (v1, no auth)" ON public.clients FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.client_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_activities_client_id ON public.client_activities(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_activities TO anon, authenticated;
GRANT ALL ON public.client_activities TO service_role;
ALTER TABLE public.client_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access (v1, no auth)" ON public.client_activities FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text TEXT NOT NULL,
  parsed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imports TO anon, authenticated;
GRANT ALL ON public.imports TO service_role;
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access (v1, no auth)" ON public.imports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.clients_validate()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.visits_used < 0 THEN NEW.visits_used := 0; END IF;
  IF NEW.amount_paid < 0 THEN NEW.amount_paid := 0; END IF;
  IF NEW.visits_used > NEW.package_total_visits THEN
    RAISE EXCEPTION 'visits_used (%) cannot exceed package_total_visits (%)', NEW.visits_used, NEW.package_total_visits;
  END IF;
  IF NEW.amount_paid > NEW.package_price THEN
    RAISE EXCEPTION 'amount_paid (%) cannot exceed package_price (%)', NEW.amount_paid, NEW.package_price;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_clients_validate BEFORE INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.clients_validate();
