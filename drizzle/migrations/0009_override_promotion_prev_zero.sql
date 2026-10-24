DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.start_pending_override_from_square(uuid,text,date,integer,jsonb)'::regprocedure),
    'IF v_prev_owed IS NOT NULL AND v_prev_owed > 0 THEN', 'IF v_prev_owed IS NOT NULL THEN');
END $$;