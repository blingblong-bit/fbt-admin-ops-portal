DROP POLICY IF EXISTS "Authenticated staff can manage Notes Ledger resolutions" ON public.notes_ledger_resolutions;

CREATE POLICY "Signed-in staff can view Notes Ledger resolutions"
ON public.notes_ledger_resolutions
FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

CREATE POLICY "Signed-in staff can create Notes Ledger resolutions"
ON public.notes_ledger_resolutions
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Signed-in staff can update Notes Ledger resolutions"
ON public.notes_ledger_resolutions
FOR UPDATE
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Signed-in staff can delete Notes Ledger resolutions"
ON public.notes_ledger_resolutions
FOR DELETE
TO authenticated
USING (auth.role() = 'authenticated');