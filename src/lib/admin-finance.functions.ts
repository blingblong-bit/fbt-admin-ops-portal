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

export type PackageEvidence = {
  bookings: { start_at: string; status: string; note: string }[];
  payments: { at: string; amount: number; ref: string; source: "square" | "manual"; where: string }[];
  squareError: string | null;
};

/** Read-only: Square appointment notes (~120 days back, 45 ahead) + recorded payments. Never writes. */
export const getPackageEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }): Promise<PackageEvidence> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { paymentSource } = await import("./package-correction");
    const [{ data: client, error: e1 }, { data: acts, error: e2 }] = await Promise.all([
      ctx.supabase.from("clients").select("square_customer_id").eq("id", data.clientId).single(),
      ctx.supabase.from("client_activities").select("created_at, metadata").eq("client_id", data.clientId).eq("activity_type", "payment").order("created_at", { ascending: false }),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const payments = ((acts ?? []) as { created_at: string; metadata: Record<string, any> | null }[]).map((a) => {
      const m = a.metadata ?? {};
      const where = [
        Number(m.applied_to_previous_package) ? `previous $${Number(m.applied_to_previous_package)}` : "",
        Number(m.applied_to_current_package) ? `current $${Number(m.applied_to_current_package)}` : "",
        Number(m.applied_to_pending_package) ? `prepared renewal $${Number(m.applied_to_pending_package)}` : "",
      ].filter(Boolean).join(", ");
      return { at: a.created_at, amount: Number(m.amount ?? m.applied_amount ?? 0), ref: String(m.square_payment_id ?? ""), source: paymentSource(m), where: where || "split not recorded" };
    });
    const bookings: PackageEvidence["bookings"] = [];
    let squareError: string | null = null;
    const cid = (client as { square_customer_id: string | null } | null)?.square_customer_id;
    const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "").trim();
    if (!cid) squareError = "Not linked to Square.";
    else if (!token) squareError = "Square is not configured.";
    else {
      const day = 86_400_000;
      const now = Date.now();
      try {
        for (let off = -120; off < 45; off += 31) {
          const url = new URL("https://connect.squareup.com/v2/bookings");
          url.searchParams.set("customer_id", cid);
          url.searchParams.set("limit", "200");
          url.searchParams.set("start_at_min", new Date(now + off * day).toISOString());
          url.searchParams.set("start_at_max", new Date(now + Math.min(off + 31, 45) * day).toISOString());
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17" } });
          if (!r.ok) { squareError = `Square returned ${r.status}`; break; }
          const j = (await r.json()) as { bookings?: { start_at: string; status: string; seller_note?: string; customer_note?: string }[] };
          for (const b of j.bookings ?? []) bookings.push({ start_at: b.start_at, status: b.status, note: (b.seller_note ?? b.customer_note ?? "").trim() });
        }
      } catch (e) {
        squareError = (e as Error).message;
      }
    }
    bookings.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return { bookings, payments, squareError };
  });

export const listPackageOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data: rows, error } = await ctx.supabase
      .from("package_overrides").select("*").eq("client_id", data.clientId).is("cleared_at", null);
    if (error) throw error;
    return (rows ?? []) as import("./package-override").PackageOverride[];
  });

export const setPackageOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; slot: "current" | "pending" | "previous"; values: Record<string, unknown>; reason: string }) => {
    if (!d?.clientId || !d.slot) throw new Error("Package required");
    if (!d.reason?.trim()) throw new Error("A reason is required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data: res, error } = await ctx.supabase.rpc("set_package_override", {
      p_client_id: data.clientId, p_slot: data.slot, p_values: data.values, p_reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return res as { changed: boolean };
  });

export const clearPackageOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; slot: "current" | "pending" | "previous"; reason: string }) => {
    if (!d?.clientId || !d.reason?.trim()) throw new Error("A reason is required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { data: res, error } = await ctx.supabase.rpc("clear_package_override", {
      p_client_id: data.clientId, p_slot: data.slot, p_reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return res as { changed: boolean };
  });
