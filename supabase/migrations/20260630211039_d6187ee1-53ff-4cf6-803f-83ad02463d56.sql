ALTER TABLE public.square_customer_reviews
  ADD COLUMN IF NOT EXISTS relevance text NOT NULL DEFAULT 'possible_match';

CREATE INDEX IF NOT EXISTS idx_square_customer_reviews_relevance
  ON public.square_customer_reviews(relevance, status);