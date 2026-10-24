CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE OR REPLACE FUNCTION public.store_activation_cron_secret(p_secret text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_id uuid;
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 32 THEN RAISE EXCEPTION 'secret too short'; END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'activation_cron_secret';
  IF v_id IS NULL THEN PERFORM vault.create_secret(p_secret, 'activation_cron_secret', 'Bearer for /api/public/renewal-activation-tick');
  ELSE PERFORM vault.update_secret(v_id, p_secret); END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.store_activation_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_activation_cron_secret(text) TO service_role;