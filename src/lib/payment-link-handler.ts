// Handles a Square payment that belongs to a stored checkout-link order. The
// caller passes its environment (sandbox route vs production webhook); link
// lookup, fixture rules and credit target are all scoped to that environment.
import { planLinkPayment, type LinkEnv, type LinkPlan } from "./payment-link";

export type LinkDb = {
  findLink(env: LinkEnv, orderId: string): Promise<any | null>;
  getClient(id: string): Promise<{ id: string; is_test_fixture: boolean } | null>;
  apply(clientId: string, paymentId: string, cents: number): Promise<{ credited: boolean }>;
  updateLink(id: string, patch: Record<string, unknown>): Promise<void>;
  /** Production only: the payment ledger row; sandbox never writes it. */
  recordPayment?(row: { paymentId: string; clientId: string | null; cents: number; status: string; applied: boolean; needsReview: boolean }): Promise<void>;
};

export async function handleLinkPayment(
  db: LinkDb,
  env: LinkEnv,
  p: { orderId: string | null; paymentId: string; amountCents: number; status: string },
): Promise<LinkPlan & { credited?: boolean }> {
  if (!p.orderId) return { kind: "not_link" };
  const link = await db.findLink(env, p.orderId);
  if (!link) return { kind: "not_link" };
  const client = await db.getClient(link.client_id);
  const plan = planLinkPayment({ env, link, client, paymentId: p.paymentId, amountCents: p.amountCents, status: p.status });
  const base = { payment_status: p.status, payment_amount_cents: p.amountCents };

  if (plan.kind === "hold") {
    // Real money is kept and flagged; never credited automatically.
    await db.updateLink(link.id, { ...base, status: "review", hold_reason: plan.reason, square_payment_id: link.square_payment_id ?? p.paymentId });
    await db.recordPayment?.({ paymentId: p.paymentId, clientId: link.client_id, cents: p.amountCents, status: p.status, applied: false, needsReview: true });
    return plan;
  }
  if (plan.kind === "record_only") {
    await db.updateLink(link.id, base);
    await db.recordPayment?.({ paymentId: p.paymentId, clientId: link.client_id, cents: p.amountCents, status: p.status, applied: false, needsReview: false });
    return plan;
  }
  if (plan.kind === "not_link") return plan;
  // apply / replay: apply_square_payment is idempotent per payment ID.
  const r = await db.apply(plan.clientId, p.paymentId, p.amountCents);
  if (plan.kind === "apply") {
    await db.updateLink(link.id, { ...base, status: "paid", square_payment_id: p.paymentId, paid_at: new Date().toISOString() });
  }
  await db.recordPayment?.({ paymentId: p.paymentId, clientId: plan.clientId, cents: p.amountCents, status: p.status, applied: true, needsReview: false });
  return { ...plan, credited: r.credited };
}

/** Supabase-backed adapter. Sandbox adapter has no recordPayment. */
export function supabaseLinkDb(admin: any, env: LinkEnv, apply: LinkDb["apply"]): LinkDb {
  const db: LinkDb = {
    async findLink(e, orderId) {
      const { data, error } = await admin.from("square_payment_links")
        .select("id, client_id, amount_cents, status, square_payment_id, environment")
        .eq("square_order_id", orderId).eq("environment", e).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getClient(id) {
      const { data, error } = await admin.from("clients").select("id, is_test_fixture").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    apply,
    async updateLink(id, patch) {
      const { error } = await admin.from("square_payment_links").update(patch).eq("id", id);
      if (error) throw error;
    },
  };
  if (env === "production") {
    db.recordPayment = async (r) => {
      const { error } = await admin.from("square_payments").upsert({
        square_payment_id: r.paymentId, client_id: r.clientId, amount_cents: r.cents, status: r.status,
        applied: r.applied, needs_review: r.needsReview,
      }, { onConflict: "square_payment_id" });
      if (error) throw error;
    };
  }
  return db;
}
