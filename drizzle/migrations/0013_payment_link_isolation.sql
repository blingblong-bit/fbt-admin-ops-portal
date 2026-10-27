ALTER TABLE public.clients ADD COLUMN is_test_fixture boolean NOT NULL DEFAULT false;
ALTER TABLE public.square_payment_links ADD COLUMN generation integer NOT NULL DEFAULT 0;
ALTER TABLE public.square_payment_links ADD COLUMN hold_reason text;
ALTER TABLE public.square_payment_links ADD COLUMN payment_amount_cents integer;
ALTER TABLE public.square_payment_links ADD COLUMN payment_status text;
CREATE UNIQUE INDEX square_payment_links_generation ON public.square_payment_links (client_id, environment, generation);