ALTER TABLE public.clients
  ADD COLUMN billing_type text NOT NULL DEFAULT 'package',
  ADD COLUMN per_visit_rate numeric,
  ADD COLUMN weekly_rate numeric,
  ADD COLUMN billing_effective_date date;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_billing_type_check CHECK (billing_type IN ('package','pay_per_visit','weekly'));