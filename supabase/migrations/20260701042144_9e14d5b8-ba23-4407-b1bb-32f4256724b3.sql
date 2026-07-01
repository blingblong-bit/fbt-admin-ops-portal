
CREATE TABLE public.duplicate_client_reviews (
  id uuid primary key default gen_random_uuid(),
  client_a_id uuid not null references public.clients(id) on delete cascade,
  client_b_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'pending',
  reason text,
  kept_client_id uuid references public.clients(id) on delete set null,
  archived_client_id uuid references public.clients(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duplicate_client_reviews_pair_order check (client_a_id < client_b_id),
  constraint duplicate_client_reviews_pair_unique unique (client_a_id, client_b_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.duplicate_client_reviews TO authenticated;
GRANT ALL ON public.duplicate_client_reviews TO service_role;

ALTER TABLE public.duplicate_client_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff full access"
  ON public.duplicate_client_reviews FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_duplicate_client_reviews_updated_at
  BEFORE UPDATE ON public.duplicate_client_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX duplicate_client_reviews_status_idx ON public.duplicate_client_reviews(status);
