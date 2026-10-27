CREATE TABLE public.square_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  obligation_key text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  idempotency_key text NOT NULL UNIQUE,
  square_order_id text UNIQUE,
  square_link_id text,
  url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','superseded','review')),
  square_payment_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX square_payment_links_one_active ON public.square_payment_links (client_id, environment) WHERE status = 'active';
GRANT SELECT ON public.square_payment_links TO authenticated;
GRANT ALL ON public.square_payment_links TO service_role;
ALTER TABLE public.square_payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment links" ON public.square_payment_links FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));