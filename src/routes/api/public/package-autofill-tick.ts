import { createFileRoute } from "@tanstack/react-router";

// Nightly cron: auto-fill package shells from Square visit notes for clients
// with no package info. Idempotent, no money/text side effects. Guarded by the
// project apikey header (same as the renewal tick).
function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

export const Route = createFileRoute("/api/public/package-autofill-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || request.headers.get("apikey") !== expected) {
          return new Response("forbidden", { status: 403 });
        }
        const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
        if (!token) return new Response("no square token", { status: 500 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runPackageAutofill } = await import("@/lib/package-autofill.server");
        const report = await runPackageAutofill(supabaseAdmin, token);
        return Response.json({
          ok: report.ok,
          error: report.error,
          filled: report.filled.map((f) => `${f.name} ${f.visitsUsed}/${f.totalVisits}`),
          flagged: report.flaggedOnly.map((f) => f.name),
          skippedNoNotes: report.skippedNoNotes,
          debug: (report as any).debug,
          errors: report.errors,
        });
      },
    },
  },
});
