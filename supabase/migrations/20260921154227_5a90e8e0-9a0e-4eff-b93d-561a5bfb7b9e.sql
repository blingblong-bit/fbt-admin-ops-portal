ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sms_consent_recorded_by uuid,
  ADD COLUMN IF NOT EXISTS sms_opt_out_source text;

ALTER TABLE public.dues_messages
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE INDEX IF NOT EXISTS dues_messages_twilio_sid_idx
  ON public.dues_messages (twilio_sid);

-- Inbound replies share no obligation key with outbound drafts, so the
-- uniqueness rule applies to outbound rows only.
DROP INDEX IF EXISTS public.dues_messages_request_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS dues_messages_outbound_request_key_key
  ON public.dues_messages (request_key)
  WHERE direction = 'outbound';