
-- Explicit staff-only write policies for square_payments and square_sync_log
CREATE POLICY "Staff can manage square payments" ON public.square_payments
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff can manage sync log" ON public.square_sync_log
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- user_roles: only superadmins may write; explicitly block self-insert of privileged roles.
-- No permissive INSERT/UPDATE/DELETE policy for regular authenticated users → all writes denied by default.
CREATE POLICY "Superadmins can manage user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

-- Revoke EXECUTE on SECURITY DEFINER functions from anon/public so unauthenticated callers cannot invoke them.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) TO service_role;
