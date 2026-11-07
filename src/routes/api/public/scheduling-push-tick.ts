import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/scheduling-push-tick')({
  server: { handlers: { POST: async ({ request }) => {
    const { handleSchedulingPushTick, runSchedulingPush } = await import('@/lib/scheduling-push.server');
    return handleSchedulingPushTick(request, {
      cronSecret: process.env.SCHEDULING_PUSH_CRON_SECRET,
      run: async () => {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        return runSchedulingPush(supabaseAdmin, process.env.SCHEDULING_PUSH_KEY_ENCRYPTION_SECRET);
      },
    });
  } } },
});