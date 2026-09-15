ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text,
  ADD COLUMN IF NOT EXISTS sms_opted_out_at timestamptz;

CREATE TABLE public.dues_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone text,
  message_type text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  package_start_date date,
  amount_due numeric NOT NULL DEFAULT 0,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'ready_not_sent',
  trigger_source text NOT NULL DEFAULT 'manual',
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked boolean NOT NULL DEFAULT false,
  twilio_sid text,
  request_key text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dues_messages_request_key_key ON public.dues_messages (request_key);
CREATE INDEX dues_messages_client_created_idx ON public.dues_messages (client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dues_messages TO authenticated;
GRANT ALL ON public.dues_messages TO service_role;

ALTER TABLE public.dues_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view dues messages"
  ON public.dues_messages FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins can create dues messages"
  ON public.dues_messages FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Admins can update dues messages"
  ON public.dues_messages FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Admins can delete dues messages"
  ON public.dues_messages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER set_dues_messages_updated_at
  BEFORE UPDATE ON public.dues_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();