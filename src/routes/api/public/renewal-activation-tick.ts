import { createFileRoute } from "@tanstack/react-router";

// Cron: activate prepared renewals that Square has started (verified past 1-of-N).
// Dry-run unless SQUARE_AUTO_ACTIVATION_ENABLED=true; body {"dryRun":true} forces dry-run.
// Guarded by the project apikey header (same as the other ticks). Idempotent.
export const Route = createFileRoute("/api/public/renewal-activation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || request.headers.get("apikey") !== expected) return new Response("forbidden", { status: 403 });
        const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
        if (!token) return new Response("no square token", { status: 500 });
        const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSquareActivationSweep } = await import("@/lib/square-activation.server");
        const r = await runSquareActivationSweep(supabaseAdmin, token, { apply: body.dryRun !== true });
        // Counts only — no client data on a public route.
        return Response.json({
          enabled: r.enabled, wrote: r.wrote, sinceYmd: r.sinceYmd, squareError: r.squareError, counts: r.counts,
          applied: r.rows.filter((x) => x.applied).length, errors: r.rows.filter((x) => x.error).length,
        });
      },
    },
  },
});
