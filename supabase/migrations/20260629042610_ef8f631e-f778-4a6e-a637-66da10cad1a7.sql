-- Lock all tables to authenticated users only; remove open anon/public access
DROP POLICY IF EXISTS "Open access (v1, no auth)" ON public.clients;
DROP POLICY IF EXISTS "Open access (v1, no auth)" ON public.client_activities;
DROP POLICY IF EXISTS "Open access (v1, no auth)" ON public.imports;

-- Revoke anon privileges; keep authenticated + service_role
REVOKE ALL ON public.clients FROM anon;
REVOKE ALL ON public.client_activities FROM anon;
REVOKE ALL ON public.imports FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imports TO authenticated;
GRANT ALL ON public.clients TO service_role;
GRANT ALL ON public.client_activities TO service_role;
GRANT ALL ON public.imports TO service_role;

-- Authenticated-only policies (any signed-in staff user has full access)
CREATE POLICY "Authenticated staff full access" ON public.clients
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated staff full access" ON public.client_activities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated staff full access" ON public.imports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);