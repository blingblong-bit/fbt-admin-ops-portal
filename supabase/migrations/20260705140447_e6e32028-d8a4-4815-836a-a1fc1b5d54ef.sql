BEGIN;

-- 1. Reassign the shell's 2 client_activities rows to the active record for audit trail
UPDATE public.client_activities
   SET client_id = '40d1041c-b8dc-4705-a395-fc6c0a877db4'
 WHERE client_id = '4a4c9a5b-d387-4c98-a29e-81c8f91a6dcf';

-- 2. Clear the shell's square_customer_id first (unique partial index requires this)
UPDATE public.clients
   SET square_customer_id = NULL
 WHERE id = '4a4c9a5b-d387-4c98-a29e-81c8f91a6dcf';

-- 3. Attach the Square customer id to the active real record
UPDATE public.clients
   SET square_customer_id = 'F7VN8GPJ6WENSD6NBYQBSWCTS4'
 WHERE id = '40d1041c-b8dc-4705-a395-fc6c0a877db4';

-- 4. Log the reattachment on the active record for audit
INSERT INTO public.client_activities (client_id, activity_type, description, metadata)
VALUES (
  '40d1041c-b8dc-4705-a395-fc6c0a877db4',
  'edit',
  'Manually reattached Square customer F7VN8GPJ6WENSD6NBYQBSWCTS4 from empty shell record 4a4c9a5b',
  jsonb_build_object(
    'reason', 'shell_reattach',
    'square_customer_id', 'F7VN8GPJ6WENSD6NBYQBSWCTS4',
    'source_shell_client_id', '4a4c9a5b-d387-4c98-a29e-81c8f91a6dcf'
  )
);

-- 5. Hard-delete the empty shell (no remaining FK references)
DELETE FROM public.clients
 WHERE id = '4a4c9a5b-d387-4c98-a29e-81c8f91a6dcf';

COMMIT;