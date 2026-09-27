import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

/**
 * Auto-create package shells from Square visit notes for clients with no
 * package info. Runs as the signed-in staff member (RLS enforces staff-only
 * writes). Idempotent: clients that already have a package are skipped.
 */
export const autofillPackagesFromSquare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    if (!token) return { ok: false as const, error: "Square token not configured" };
    const { runPackageAutofill } = await import("@/lib/package-autofill.server");
    return runPackageAutofill(context.supabase, token);
  });
