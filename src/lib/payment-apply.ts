// Shared helper for applying a Square payment to a client's balance exactly once.
// Delegates to the `apply_square_payment` SECURITY DEFINER Postgres function,
// which performs the idempotency check, balance read, capped update, and
// activity insert atomically inside a single transaction with a row-level
// lock on the target client. This prevents the read-modify-write race that
// existed when the same steps ran as four separate Supabase calls.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function applyPaymentOnce(
  supabaseAdmin: SupabaseClient<Database>,
  {
    clientId,
    squarePaymentId,
    amountCents,
    matchMethod,
    manualResolution,
  }: {
    clientId: string;
    squarePaymentId: string;
    amountCents: number;
    matchMethod: string | null;
    manualResolution?: boolean;
  },
): Promise<{ credited: boolean; appliedAmount: number; alreadyApplied: boolean }> {
  const { data, error } = await supabaseAdmin.rpc("apply_square_payment", {
    p_client_id: clientId,
    p_square_payment_id: squarePaymentId,
    p_amount_cents: amountCents,
    p_match_method: matchMethod,
    p_manual_resolution: manualResolution ?? false,
  } as never);

  if (error) {
    console.error(
      `[payment-apply] apply_square_payment RPC failed for client=${clientId} payment=${squarePaymentId}: ${error.message ?? String(error)}`,
    );
    throw error;
  }

  // The function returns a single row: { newly_applied: bool, applied_amount: numeric }.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    const msg = `[payment-apply] apply_square_payment returned no row for client=${clientId} payment=${squarePaymentId}`;
    console.error(msg);
    throw new Error(msg);
  }

  const typed = row as { newly_applied: boolean; applied_amount: number | string };
  const newlyApplied = Boolean(typed.newly_applied);
  const appliedAmount = Number(typed.applied_amount ?? 0);

  return {
    credited: newlyApplied,
    appliedAmount,
    alreadyApplied: !newlyApplied,
  };
}
