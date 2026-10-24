import { createFileRoute } from "@tanstack/react-router";

// Cron: activate prepared renewals that Square has started (verified past 1-of-N).
// Requires "Authorization: Bearer <SQUARE_ACTIVATION_CRON_SECRET>" (private,
// not a Supabase key). Dry-run unless SQUARE_AUTO_ACTIVATION_ENABLED=true;
// body {"dryRun":true} forces dry-run. Idempotent. Returns counts only.
export const Route = createFileRoute("/api/public/renewal-activation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleActivationTick } = await import("@/lib/activation-tick.server");
        return handleActivationTick(request, {
          env: process.env as Record<string, string | undefined>,
          loadAdmin: async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin,
          runSweep: async (admin, token, opts) =>
            (await import("@/lib/square-activation.server")).runSquareActivationSweep(admin, token, opts),
        });
      },
    },
  },
});
