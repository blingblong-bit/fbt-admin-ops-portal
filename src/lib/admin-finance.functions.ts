// Admin financial corrections. Every money change runs inside one locked
// database function (reallocate_payment / update_client_details /
// undo_last_renewal) that re-checks the caller's role.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { paymentStatus, type Activity, type Bucket, type LedgerRow, type PaymentStatus } from "./payment-allocation";

type Ctx = { supabase: any; userId: string };

async function assertAdmin(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
  if (error) throw error;
  if (!data) throw new Error("Only admins can do this.");
}

export const listPaymentAllocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }): Promise<PaymentStatus[]> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const [{ data: acts, error: e1 }, { data: ledger, error: e2 }] = await Promise.all([
      ctx.supabase.from("client_activities").select("id, activity_type, created_at, metadata").eq("client_id", data.clientId).order("created_at"),
      ctx.supabase.from("payment_allocations").select("payment_ref, kind, bucket, amount").eq("client_id", data.clientId),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const all = (acts ?? []) as Activity[];
    return all
      .filter((a) => a.activity_type === "payment" && a.metadata?.square_payment_id)
      .map((p) =>
        paymentStatus(
          p,
          all,
          ((ledger ?? []) as (LedgerRow & { payment_ref: string })[]).filter((r) => r.payment_ref === p.metadata!.square_payment_id),
        ),
      )
      .reverse();
  });

export const reallocatePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; paymentRef: string; from: Bucket; to: Bucket; amount: number; reason: string }) => {
    if (!d?.clientId || !d.paymentRef) throw new Error("Payment required");
    if (!(Number(d.amount) > 0)) throw new Error("Enter an amount greater than 0");
    if (!d.reason?.trim()) throw new Error("A reason is required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.rpc("reallocate_payment", {
      p_client_id: data.clientId,
      p_payment_ref: data.paymentRef,
      p_from: data.from,
      p_to: data.to,
      p_amount: Math.round(Number(data.amount) * 100) / 100,
      p_reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateClientDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; patch: Record<string, unknown>; reason?: string }) => {
    if (!d?.clientId || !d.patch) throw new Error("clientId and patch required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: res, error } = await ctx.supabase.rpc("update_client_details", {
      p_client_id: data.clientId,
      p_patch: data.patch,
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return res as { changed: boolean };
  });

export const undoLastRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; reason: string }) => {
    if (!d?.clientId || !d.reason?.trim()) throw new Error("A reason is required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.rpc("undo_last_renewal", { p_client_id: data.clientId, p_reason: data.reason.trim() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
