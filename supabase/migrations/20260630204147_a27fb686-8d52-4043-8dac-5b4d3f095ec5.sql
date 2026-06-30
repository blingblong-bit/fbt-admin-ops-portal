CREATE TABLE public.square_customer_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  square_customer_id text NOT NULL UNIQUE,
  given_name text,
  family_name text,
  email text,
  phone text,
  suggested_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.square_customer_reviews TO authenticated;
GRANT ALL ON public.square_customer_reviews TO service_role;

ALTER TABLE public.square_customer_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff full access"
  ON public.square_customer_reviews FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_square_customer_reviews_status ON public.square_customer_reviews(status);

CREATE TRIGGER trg_square_customer_reviews_updated_at
  BEFORE UPDATE ON public.square_customer_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();