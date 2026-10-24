CREATE TABLE public.schedule_hides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  reason text,
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  known_future_booking_ids text[] NOT NULL DEFAULT '{}',
  package_start_snapshot date,
  pending_renewal_snapshot date,
  cleared_at timestamptz,
  cleared_by uuid,
  clear_reason text,
  auto_cleared boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX schedule_hides_one_active ON public.schedule_hides(client_id) WHERE cleared_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.schedule_hides TO authenticated;
GRANT ALL ON public.schedule_hides TO service_role;
ALTER TABLE public.schedule_hides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view schedule hides" ON public.schedule_hides FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff add schedule hides" ON public.schedule_hides FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()) AND hidden_by = auth.uid() AND cleared_at IS NULL);
CREATE POLICY "Staff clear schedule hides" ON public.schedule_hides FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));