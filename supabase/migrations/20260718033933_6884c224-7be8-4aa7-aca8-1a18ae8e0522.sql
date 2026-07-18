
-- Package renewal SMS campaign state
CREATE TABLE public.renewal_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Snapshot of the package the campaign is tied to. When the client starts a
  -- new package (package_start_date advances past created_at, or
  -- package_total_visits/price change), the campaign is considered
  -- "self-cleared".
  package_start_date_snapshot DATE,
  package_total_visits_snapshot INTEGER NOT NULL,
  last_visit_date DATE, -- clinic-local YYYY-MM-DD of their final visit (from Square)
  -- Lifecycle
  --  active         → outbound sequence in progress
  --  yes            → client replied yes; awaiting new package creation
  --  no             → client replied no; stop
  --  manual_review  → 3 unanswered OR unclear reply
  --  renewed        → auto-cleared: staff created a new package
  --  cancelled      → manually cancelled
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','yes','no','manual_review','renewed','cancelled')),
  sends_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  reply_text TEXT,
  reply_at TIMESTAMPTZ,
  notified_owner_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, package_start_date_snapshot, package_total_visits_snapshot)
);

CREATE INDEX renewal_campaigns_status_idx ON public.renewal_campaigns(status);
CREATE INDEX renewal_campaigns_client_id_idx ON public.renewal_campaigns(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.renewal_campaigns TO authenticated;
GRANT ALL ON public.renewal_campaigns TO service_role;

ALTER TABLE public.renewal_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage renewal campaigns"
  ON public.renewal_campaigns FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER renewal_campaigns_updated_at
  BEFORE UPDATE ON public.renewal_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Message log (outbound + inbound)
CREATE TABLE public.renewal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.renewal_campaigns(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  sequence_index INTEGER, -- 1,2,3 for outbound; null for inbound
  to_number TEXT,
  from_number TEXT,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX renewal_messages_campaign_id_idx ON public.renewal_messages(campaign_id);
CREATE INDEX renewal_messages_twilio_sid_idx ON public.renewal_messages(twilio_sid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.renewal_messages TO authenticated;
GRANT ALL ON public.renewal_messages TO service_role;

ALTER TABLE public.renewal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage renewal messages"
  ON public.renewal_messages FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));
