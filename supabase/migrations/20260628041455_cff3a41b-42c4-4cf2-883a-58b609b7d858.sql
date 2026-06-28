ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS square_visit_note text;
ALTER TABLE public.clients ALTER COLUMN visits_used DROP NOT NULL;
ALTER TABLE public.clients ALTER COLUMN visits_used DROP DEFAULT;
UPDATE public.clients SET visits_used = NULL WHERE visits_used = 0;