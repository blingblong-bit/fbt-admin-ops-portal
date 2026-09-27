CREATE TABLE public.visit_note_confirmations (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  reason text,
  confirmed_by uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_note_confirmations TO authenticated;
GRANT ALL ON public.visit_note_confirmations TO service_role;
ALTER TABLE public.visit_note_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage visit note confirmations" ON public.visit_note_confirmations
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superadmin'));