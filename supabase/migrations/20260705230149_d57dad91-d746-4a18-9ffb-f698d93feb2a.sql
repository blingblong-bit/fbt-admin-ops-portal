ALTER TABLE public.clients DROP COLUMN IF EXISTS is_scheduled;
DROP INDEX IF EXISTS public.clients_status_idx;