ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS manual_active boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS clients_status_idx ON public.clients (status) WHERE deleted_at IS NULL;