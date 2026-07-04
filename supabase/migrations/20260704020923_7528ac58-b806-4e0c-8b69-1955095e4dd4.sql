-- 1) Remove duplicate client_activities rows sharing the same square_payment_id,
--    keeping the oldest row (by created_at ASC) per square_payment_id.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY (metadata->>'square_payment_id')
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.client_activities
  WHERE metadata ? 'square_payment_id'
    AND metadata->>'square_payment_id' IS NOT NULL
)
DELETE FROM public.client_activities ca
USING ranked
WHERE ca.id = ranked.id
  AND ranked.rn > 1;

-- 2) Enforce global uniqueness: the same Square payment ID cannot appear on
--    any client more than once.
CREATE UNIQUE INDEX IF NOT EXISTS client_activities_square_payment_id_uniq
  ON public.client_activities ((metadata->>'square_payment_id'))
  WHERE metadata->>'square_payment_id' IS NOT NULL;

-- 3) GIN index for fast @> contains queries on metadata (used by
--    applyPaymentOnce's existing-activity guard).
CREATE INDEX IF NOT EXISTS client_activities_metadata_gin
  ON public.client_activities
  USING gin (metadata jsonb_path_ops);
