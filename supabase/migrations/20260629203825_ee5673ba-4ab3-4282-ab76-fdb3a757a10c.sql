
CREATE TABLE public.square_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_payment_id text NOT NULL UNIQUE,
  square_customer_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text,
  applied boolean NOT NULL DEFAULT false,
  needs_review boolean NOT NULL DEFAULT false,
  buyer_email text,
  buyer_phone text,
  note text,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.square_payments TO authenticated;
GRANT ALL ON public.square_payments TO service_role;

ALTER TABLE public.square_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can read square payments"
ON public.square_payments FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_square_payments_client ON public.square_payments(client_id);
CREATE INDEX idx_square_payments_needs_review ON public.square_payments(needs_review) WHERE needs_review = true;

CREATE TRIGGER square_payments_set_updated_at
BEFORE UPDATE ON public.square_payments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
