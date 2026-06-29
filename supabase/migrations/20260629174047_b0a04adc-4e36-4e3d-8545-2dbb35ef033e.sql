
-- 1. Add Square link + review flag to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS square_customer_id text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS clients_square_customer_id_key
  ON public.clients (square_customer_id)
  WHERE square_customer_id IS NOT NULL;

-- 2. Square sync log
CREATE TABLE IF NOT EXISTS public.square_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  square_customer_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success', 'skipped', 'error')),
  action text,
  message text,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.square_sync_log TO authenticated;
GRANT ALL ON public.square_sync_log TO service_role;

ALTER TABLE public.square_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can read sync log"
  ON public.square_sync_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS square_sync_log_created_at_idx
  ON public.square_sync_log (created_at DESC);
CREATE INDEX IF NOT EXISTS square_sync_log_square_customer_id_idx
  ON public.square_sync_log (square_customer_id);
