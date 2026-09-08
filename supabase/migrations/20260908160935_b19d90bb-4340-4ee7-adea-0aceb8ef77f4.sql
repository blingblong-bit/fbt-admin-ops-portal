ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pending_renewal_start_date date,
  ADD COLUMN IF NOT EXISTS pending_renewal_price numeric,
  ADD COLUMN IF NOT EXISTS pending_renewal_total_visits integer,
  ADD COLUMN IF NOT EXISTS pending_renewal_package_name text,
  ADD COLUMN IF NOT EXISTS pending_renewal_created_at timestamptz;