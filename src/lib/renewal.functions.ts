import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RenewPackageInput = {
  clientId: string;
  packageName: string | null;
  totalVisits: number;
  price: number;
  startDate: string | null;
  /** Money collected right now, on top of anything already prepaid. */
  paidNow?: number;
  source?: "manual_renewal" | "pre_renewal_activation" | "boundary_activation";
  bookingId?: string | null;
  /** Visits already used on the new package (Square boundary activation). Default 0. */
  visitsUsed?: number;
};

export type RenewPackageResult = {
  previous_package_owed: number;
  amount_paid: number;
  prepaid_applied: number;
  unpaid_carried_forward: number;
};

/**
 * Single locked renewal: finishes the current package, carries unpaid money
 * forward as previous-package debt, and starts the new package already
 * credited with any money that was prepaid against the prepared renewal.
 *
 * Runs entirely inside one security-definer database function so an incoming
 * Square payment can never be wiped mid-renewal and a renewal can never be
 * left half-applied.
 */
export async function renewClientPackage(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  input: RenewPackageInput,
): Promise<RenewPackageResult> {
  const { data, error } = await admin.rpc("renew_client_package", {
    p_client_id: input.clientId,
    p_package_name: input.packageName,
    p_total_visits: Math.max(0, Number(input.totalVisits ?? 0)),
    p_price: Number(input.price ?? 0),
    p_start_date: input.startDate,
    p_extra_paid: Math.max(0, Number(input.paidNow ?? 0)),
    p_source: input.source ?? "manual_renewal",
    p_booking_id: input.bookingId ?? null,
    p_visits_used: Math.max(0, Number(input.visitsUsed ?? 0)),
  });
  if (error) throw error as Error;
  const row = (Array.isArray(data) ? data[0] : data) as RenewPackageResult | undefined;
  return {
    previous_package_owed: Number(row?.previous_package_owed ?? 0),
    amount_paid: Number(row?.amount_paid ?? 0),
    prepaid_applied: Number(row?.prepaid_applied ?? 0),
    unpaid_carried_forward: Number(row?.unpaid_carried_forward ?? 0),
  };
}

export const renewPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: RenewPackageInput) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }): Promise<RenewPackageResult> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return renewClientPackage(supabaseAdmin as never, { ...data, source: "manual_renewal" });
  });

/** Staff: activate ONE client's prepared renewal from verified Square 1/N
 *  (same evidence rules as the scheduled sweep, no backlog cutoff). */
export const activatePreparedFromSquare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!staff) throw new Error("Forbidden");
    const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
    if (!token) throw new Error("Square is not configured.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runSquareActivationSweep } = await import("./square-activation.server");
    const r = await runSquareActivationSweep(supabaseAdmin, token, { apply: true, clientId: data.clientId, manual: true });
    if (r.squareError) throw new Error("Couldn't read Square right now. Nothing was changed.");
    const row = r.rows[0];
    if (!row) throw new Error("No prepared renewal found for this client.");
    const d = row.decision as any;
    return { applied: !!row.applied, error: row.error ?? null, kind: d.kind as string, reason: (d.reason ?? null) as string | null, startYmd: (d.startYmd ?? null) as string | null };
  });
