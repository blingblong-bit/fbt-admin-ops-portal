CREATE TABLE public.notes_ledger_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_fingerprint text NOT NULL UNIQUE,
  resolution_status text NOT NULL CHECK (resolution_status IN ('imported', 'skipped', 'resolved')),
  resolved_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  line_number integer,
  raw_row text,
  normalized_row_content text,
  parsed_name text,
  parsed_phone text,
  leading_amount numeric,
  package_price numeric,
  package_total_visits integer,
  package_start_date date,
  internal_notes text,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes_ledger_resolutions TO authenticated;
GRANT ALL ON public.notes_ledger_resolutions TO service_role;

ALTER TABLE public.notes_ledger_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can manage Notes Ledger resolutions"
ON public.notes_ledger_resolutions
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER set_notes_ledger_resolutions_updated_at
BEFORE UPDATE ON public.notes_ledger_resolutions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX notes_ledger_resolutions_resolved_client_id_idx
ON public.notes_ledger_resolutions (resolved_client_id);

CREATE INDEX notes_ledger_resolutions_resolved_at_idx
ON public.notes_ledger_resolutions (resolved_at DESC);