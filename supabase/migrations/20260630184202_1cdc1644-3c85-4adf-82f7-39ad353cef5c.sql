-- Consolidate Square customer ID columns: production_square_customer_id was a Sandbox-era split.
-- Move any production_square_customer_id values into square_customer_id, then drop the extra column.
UPDATE public.clients
SET square_customer_id = production_square_customer_id
WHERE production_square_customer_id IS NOT NULL
  AND (square_customer_id IS NULL OR square_customer_id <> production_square_customer_id);

DROP INDEX IF EXISTS public.clients_production_square_customer_id_idx;
ALTER TABLE public.clients DROP COLUMN IF EXISTS production_square_customer_id;