// Pure rules for Square checkout links (proof stage). Amounts come ONLY from
// the Master Dues row (effective, override-applied balance); never raw fields.
import type { MasterDuesRow } from "./master-dues";

export type LinkObligation =
  | { ok: true; clientId: string; amountCents: number; obligationKey: string }
  | { ok: false; reason: "already_paid" | "needs_review" | "billing_client" | "no_row" };

/** Boundaries = effective package start dates (current + prepared). */
export function obligationFor(
  row: MasterDuesRow | undefined,
  boundaries: { currentStart: string | null; preparedStart: string | null },
): LinkObligation {
  if (!row) return { ok: false, reason: "no_row" };
  if (row.billing.type) return { ok: false, reason: "billing_client" };
  if ([row.previous.status, row.current.status, row.renewal.status].includes("needs_review")) {
    return { ok: false, reason: "needs_review" };
  }
  const amountCents = Math.round(row.total * 100);
  if (amountCents <= 0) return { ok: false, reason: "already_paid" };
  return {
    ok: true,
    clientId: row.client_id,
    amountCents,
    obligationKey: `${row.client_id}|cur:${boundaries.currentStart ?? "-"}|prep:${boundaries.preparedStart ?? "-"}|${amountCents}`,
  };
}

export type ExistingLink = { id: string; obligation_key: string; status: string; url: string | null };

/** Reuse an identical active link; otherwise the old one is stale and superseded. */
export function decideLink(active: ExistingLink | null, ob: Extract<LinkObligation, { ok: true }>) {
  if (active && active.obligation_key === ob.obligationKey) return { action: "reuse" as const, link: active };
  return { action: "create" as const, supersede: active?.id ?? null };
}

/** Deterministic Square idempotency key: same obligation → same Square link. */
/** Generation = rows already issued for this client; a failed create retries with the same key. */
export function idempotencyKeyFor(obligationKey: string, environment: string, generation = 0) {
  return `fbt-link:${environment}:g${generation}:${obligationKey}`.slice(0, 192);
}

export type LinkRow = { id: string; client_id: string; amount_cents: number; status: string; square_payment_id: string | null };

export type LinkEnv = "sandbox" | "production";
export type PlanInput = {
  env: LinkEnv;
  link: (LinkRow & { environment: string }) | null;
  client: { id: string; is_test_fixture: boolean } | null;
  paymentId: string;
  amountCents: number;
  status: string;
};
export type LinkPlan =
  | { kind: "not_link" }
  | { kind: "record_only" }
  | { kind: "apply"; clientId: string }
  | { kind: "replay"; clientId: string }
  | { kind: "hold"; reason: string };

/**
 * Single decision for a payment on a stored link order. "hold" keeps the real
 * payment recorded and flagged, with NO credit — a changed/stale/mismatched
 * obligation is never auto-allocated.
 */
export function planLinkPayment(i: PlanInput): LinkPlan {
  const l = i.link;
  if (!l || l.environment !== i.env) return { kind: "not_link" };
  if (!i.client || i.client.id !== l.client_id) return { kind: "hold", reason: "mapping_invalid" };
  if (i.env === "sandbox" && !i.client.is_test_fixture) return { kind: "hold", reason: "sandbox_non_fixture" };
  if (i.env === "production" && i.client.is_test_fixture) return { kind: "hold", reason: "fixture_in_production" };
  if (l.square_payment_id && l.square_payment_id !== i.paymentId) return { kind: "hold", reason: "second_payment_on_link" };
  if (l.square_payment_id === i.paymentId) {
    return l.status === "paid" ? { kind: "replay", clientId: l.client_id } : { kind: "hold", reason: "held_replay" };
  }
  if (i.status.toUpperCase() !== "COMPLETED") return { kind: "record_only" };
  if (l.status === "superseded") return { kind: "hold", reason: "paid_stale_link" };
  if (l.status !== "active") return { kind: "hold", reason: `link_${l.status}` };
  if (i.amountCents !== l.amount_cents) return { kind: "hold", reason: "amount_differs_from_link" };
  return { kind: "apply", clientId: l.client_id };
}
