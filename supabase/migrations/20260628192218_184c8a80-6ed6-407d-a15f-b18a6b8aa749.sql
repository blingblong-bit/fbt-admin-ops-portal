ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS clients_deleted_at_idx ON public.clients (deleted_at);