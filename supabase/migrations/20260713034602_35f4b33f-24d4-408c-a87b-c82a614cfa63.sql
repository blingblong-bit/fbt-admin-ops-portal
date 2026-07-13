
-- Helper: any staff-level role (staff, admin, superadmin)
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('staff','admin','superadmin')
  )
$$;

-- clients
DROP POLICY IF EXISTS "Authenticated staff full access" ON public.clients;
CREATE POLICY "Staff full access" ON public.clients
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- client_activities
DROP POLICY IF EXISTS "Authenticated staff full access" ON public.client_activities;
CREATE POLICY "Staff full access" ON public.client_activities
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- duplicate_client_reviews
DROP POLICY IF EXISTS "Authenticated staff full access" ON public.duplicate_client_reviews;
CREATE POLICY "Staff full access" ON public.duplicate_client_reviews
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- imports
DROP POLICY IF EXISTS "Authenticated staff full access" ON public.imports;
CREATE POLICY "Staff full access" ON public.imports
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- square_customer_reviews
DROP POLICY IF EXISTS "Authenticated staff full access" ON public.square_customer_reviews;
CREATE POLICY "Staff full access" ON public.square_customer_reviews
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- square_payments (SELECT only currently)
DROP POLICY IF EXISTS "Authenticated staff can read square payments" ON public.square_payments;
CREATE POLICY "Staff can read square payments" ON public.square_payments
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- square_sync_log (SELECT only currently)
DROP POLICY IF EXISTS "Authenticated staff can read sync log" ON public.square_sync_log;
CREATE POLICY "Staff can read sync log" ON public.square_sync_log
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- notes_ledger_resolutions (split policies)
DROP POLICY IF EXISTS "Signed-in staff can create Notes Ledger resolutions" ON public.notes_ledger_resolutions;
DROP POLICY IF EXISTS "Signed-in staff can delete Notes Ledger resolutions" ON public.notes_ledger_resolutions;
DROP POLICY IF EXISTS "Signed-in staff can update Notes Ledger resolutions" ON public.notes_ledger_resolutions;
DROP POLICY IF EXISTS "Signed-in staff can view Notes Ledger resolutions"   ON public.notes_ledger_resolutions;

CREATE POLICY "Staff can view Notes Ledger resolutions" ON public.notes_ledger_resolutions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff can create Notes Ledger resolutions" ON public.notes_ledger_resolutions
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can update Notes Ledger resolutions" ON public.notes_ledger_resolutions
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Staff can delete Notes Ledger resolutions" ON public.notes_ledger_resolutions
  FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));
