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
export function idempotencyKeyFor(obligationKey: string, environment: string) {
  return `fbt-link:${environment}:${obligationKey}`.slice(0, 192);
}

export type LinkRow = { id: string; client_id: string; amount_cents: number; status: string; square_payment_id: string | null };

/**
 * Decide how a COMPLETED Square payment on a link's order is handled. Credit
 * itself still goes through apply_square_payment (idempotent per payment ID,
 * prior → current → prepared precedence), so a package that activates between
 * link issuance and payment is credited to wherever that debt now lives.
 */
export function reconcileLinkPayment(link: LinkRow, paymentId: string, amountCents: number) {
  if (link.square_payment_id && link.square_payment_id !== paymentId) {
    return { clientId: link.client_id, apply: true, review: "second_payment_on_link" as string | null };
  }
  if (amountCents !== link.amount_cents) {
    return { clientId: link.client_id, apply: true, review: "amount_differs_from_link" };
  }
  return { clientId: link.client_id, apply: true, review: link.status === "superseded" ? "paid_stale_link" : null };
}
