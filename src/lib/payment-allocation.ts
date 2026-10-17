// Pure rules for where each payment's money sits (previous-package debt,
// current package, prepared renewal) and for moving it safely. The database
// function `reallocate_payment` enforces the same rules atomically; this
// module mirrors them for the UI and for tests.

export type Bucket = "previous" | "current" | "pending";
export type Split = Record<Bucket, number>;
export type LedgerRow = { kind: "original" | "transfer"; bucket: Bucket; amount: number };
export type Activity = {
  id: string;
  activity_type: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};
export type ClientMoney = {
  previous_package_owed: number | null;
  amount_paid: number | null;
  pending_renewal_paid: number | null;
  pending_renewal_start_date: string | null;
};

export const BUCKETS: Bucket[] = ["previous", "current", "pending"];
export const BUCKET_LABEL: Record<Bucket, string> = {
  previous: "Previous package debt",
  current: "Current package",
  pending: "Prepared renewal",
};

/** Activities after a payment that make its recorded split unreliable. */
const BLOCKING = new Set(["renewal", "package_completed", "pre_renewal_cancelled", "notes_ledger_import", "renewal_undone"]);

const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): Split => ({ previous: 0, current: 0, pending: 0 });

/** The split recorded when the payment was applied, or null if it can't be trusted. */
export function originalFromMetadata(meta: Record<string, unknown> | null): Split | null {
  if (!meta) return null;
  const total = Number(meta.amount);
  const raw = [meta.applied_to_previous_package, meta.applied_to_current_package, meta.applied_to_pending_package];
  if (raw.some((v) => v === undefined || v === null) || !Number.isFinite(total)) return null;
  const [p, c, d] = raw.map(Number);
  if ([p, c, d].some((v) => !Number.isFinite(v) || v < 0)) return null;
  if (Math.abs(p + c + d - total) > 0.005) return null;
  return { previous: p, current: c, pending: d };
}

/** Where the money sits now: original split plus every transfer. */
export function currentSplit(rows: LedgerRow[]): Split {
  const s = zero();
  for (const r of rows) s[r.bucket] = r2(s[r.bucket] + Number(r.amount));
  return s;
}

export function splitTotal(s: Split): number {
  return r2(s.previous + s.current + s.pending);
}

export type PaymentStatus = {
  ref: string;
  amount: number;
  at: string;
  split: Split | null;
  movable: boolean;
  reason: string | null;
};

/** Status of one payment: its current split and whether it may be moved. */
export function paymentStatus(payment: Activity, all: Activity[], ledger: LedgerRow[]): PaymentStatus {
  const meta = payment.metadata ?? {};
  const ref = String(meta.square_payment_id ?? "");
  const amount = Number(meta.amount ?? 0);
  const base = { ref, amount, at: payment.created_at };
  const blocker = all.find(
    (a) =>
      a.created_at > payment.created_at &&
      (BLOCKING.has(a.activity_type) ||
        ((a.activity_type === "edit" || a.activity_type === "billing_change") && a.metadata?.money_changed !== false)),
  );
  const hasOriginal = ledger.some((r) => r.kind === "original");
  const original = hasOriginal ? null : originalFromMetadata(payment.metadata);
  if (!hasOriginal && !original) {
    return { ...base, split: null, movable: false, reason: "Needs Review: original split not recorded" };
  }
  const split = hasOriginal
    ? currentSplit(ledger)
    : currentSplit(BUCKETS.map((b) => ({ kind: "original" as const, bucket: b, amount: original![b] })));
  if (Math.abs(splitTotal(split) - amount) > 0.005) {
    return { ...base, split, movable: false, reason: "Needs Review: split does not add up to the payment" };
  }
  if (blocker && blocker.activity_type !== "edit" && blocker.activity_type !== "billing_change") {
    return { ...base, split, movable: false, reason: "Needs Review: package changed after this payment" };
  }
  if (blocker) return { ...base, split, movable: false, reason: "Needs Review: balance was edited after this payment" };
  return { ...base, split, movable: true, reason: null };
}

export type MovePlan =
  | { ok: true; split: Split; client: { previous_package_owed: number; amount_paid: number; pending_renewal_paid: number } }
  | { ok: false; error: string };

/**
 * Plan moving `amount` of one payment from one bucket to another.
 * Previous-package debt is money OWED: taking a payment's dollars off it
 * makes that debt owed again; putting dollars on it pays the debt down.
 */
export function planMove(split: Split, client: ClientMoney, from: Bucket, to: Bucket, amount: number): MovePlan {
  if (from === to) return { ok: false, error: "Choose two different places" };
  if (!(amount > 0)) return { ok: false, error: "Enter an amount greater than 0" };
  if (amount > split[from] + 0.0001) return { ok: false, error: `Only $${split[from].toFixed(2)} of this payment is there` };
  let prev = Number(client.previous_package_owed ?? 0);
  let paid = Number(client.amount_paid ?? 0);
  let pend = Number(client.pending_renewal_paid ?? 0);
  if (from === "previous") prev += amount;
  else if (from === "current") {
    if (paid < amount) return { ok: false, error: "Current package paid is below that amount" };
    paid -= amount;
  } else {
    if (pend < amount) return { ok: false, error: "Prepared renewal paid is below that amount" };
    pend -= amount;
  }
  if (to === "previous") {
    if (prev < amount) return { ok: false, error: `Previous package owes only $${prev.toFixed(2)}` };
    prev -= amount;
  } else if (to === "current") paid += amount;
  else {
    if (!client.pending_renewal_start_date) return { ok: false, error: "There is no prepared renewal" };
    pend += amount;
  }
  const next = { ...split, [from]: r2(split[from] - amount), [to]: r2(split[to] + amount) } as Split;
  return { ok: true, split: next, client: { previous_package_owed: r2(prev), amount_paid: r2(paid), pending_renewal_paid: r2(pend) } };
}

export type PriorPayment = { ref: string; amount: number; at: string };

/** Same client, same amount within 3 days → warn (never block). */
export function sameAmountWarnings(prior: PriorPayment[], amount: number, nowIso: string): PriorPayment[] {
  const now = Date.parse(nowIso);
  return prior.filter((p) => Math.abs(p.amount - amount) < 0.005 && Math.abs(now - Date.parse(p.at)) <= 3 * 864e5);
}
