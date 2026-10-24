// Admin package overrides: admin-authoritative package figures layered on top
// of the raw client record at read time. Raw fields and the Square payment
// ledger are never rewritten; a "recognized paid" override is not a payment.
// Owed is still computed once downstream (price - paid) from these effective values.

export type OverrideSlot = "current" | "pending" | "previous";
export type OverrideStatus = "active" | "prepared" | "completed";

export type PackageOverride = {
  slot: OverrideSlot;
  total_visits: number | null;
  visits_used: number | null;
  price: number | null;
  recognized_paid: number | null;
  start_date: string | null;
  status: OverrideStatus;
  reason?: string;
  created_at?: string;
  /** Raw visits_used when a current override was set; later check-ins add on top. */
  baseline_visits_used?: number | null;
  /** Set only by start_pending_override_from_square: the verified past Square 1/N that started this prepared package. */
  square_booking_id?: string | null;
  /** Raw money fields when the override row was written; later recorded payments count on top. */
  raw_baseline?: { amount_paid?: number | string | null; pending_paid?: number | string | null; prev_owed?: number | string | null } | null;
};

export type RawPackageFields = {
  package_total_visits?: number | null;
  visits_used?: number | null;
  package_price?: number | null;
  amount_paid?: number | null;
  package_start_date?: string | null;
  previous_package_owed?: number | null;
  pending_renewal_start_date?: string | null;
  pending_renewal_total_visits?: number | null;
  pending_renewal_price?: number | null;
  pending_renewal_paid?: number | null;
  visit_tracking_mode?: string | null;
};

const n = (v: unknown) => Number(v ?? 0);
const pick = <T,>(o: T | null | undefined, raw: T) => (o === null || o === undefined ? raw : o);

export type Effective<T> = T & { override_flags: string[]; has_override: boolean };

/** Apply active overrides (at most one per slot) to a client row. Pure. */
export function applyOverrides<T extends RawPackageFields>(c: T, overrides: PackageOverride[]): Effective<T> {
  const by = new Map(overrides.map((o) => [o.slot, o]));
  const out: T = { ...c };
  const flags: string[] = [];
  const cur = by.get("current");
  const pen = by.get("pending");
  const prev = by.get("previous");

  if (cur) {
    out.package_total_visits = pick(cur.total_visits, c.package_total_visits ?? null) as never;
    if (cur.visits_used !== null) {
      // Check-ins recorded after the override still count, on top of the admin figure.
      const since = cur.baseline_visits_used == null ? 0 : Math.max(0, n(c.visits_used) - n(cur.baseline_visits_used));
      const total = n(pick(cur.total_visits, c.package_total_visits ?? null));
      out.visits_used = (total > 0 ? Math.min(total, n(cur.visits_used) + since) : n(cur.visits_used) + since) as never;
    }
    out.package_price = pick(cur.price, c.package_price ?? null) as never;
    out.amount_paid = pick(cur.recognized_paid, c.amount_paid ?? null) as never;
    out.package_start_date = pick(cur.start_date, c.package_start_date ?? null) as never;
    if (!cur.square_booking_id && cur.recognized_paid !== null && n(cur.recognized_paid) !== n(c.amount_paid))
      flags.push(`Recorded paid $${n(c.amount_paid)} differs from admin-recognized $${n(cur.recognized_paid)}`);
    if (cur.visits_used !== null && n(out.visits_used) !== n(c.visits_used))
      flags.push(`Tracked visits ${n(c.visits_used)} differ from admin figure ${n(out.visits_used)}`);
  }
  if (prev) {
    const owed = Math.max(0, n(prev.price) - n(prev.recognized_paid));
    if (owed !== n(c.previous_package_owed)) flags.push(`Recorded prior-package owed $${n(c.previous_package_owed)} differs from admin figure $${owed}`);
    out.previous_package_owed = owed as never;
  }
  // A package Square started (promoted override) consumes every raw prepared
  // row dated on/before its start; its raw prepaid stays in history, unused.
  const promoted = !!cur?.square_booking_id;
  if (promoted && cur!.start_date && c.pending_renewal_start_date && c.pending_renewal_start_date <= cur!.start_date) {
    out.pending_renewal_start_date = null as never;
    out.pending_renewal_total_visits = null as never;
    out.pending_renewal_price = null as never;
  }
  if (pen) {
    if (pen.status === "active") {
      // Admin says the prepared package has started: the current package
      // becomes prior (its unpaid balance carried once), pending becomes current.
      const carried = Math.max(0, n(out.package_price) - n(out.amount_paid));
      out.previous_package_owed = (n(out.previous_package_owed) + carried) as never;
      out.package_total_visits = pick(pen.total_visits, c.pending_renewal_total_visits ?? null) as never;
      out.package_price = pick(pen.price, c.pending_renewal_price ?? null) as never;
      out.amount_paid = pick(pen.recognized_paid, c.pending_renewal_paid ?? 0) as never;
      out.visits_used = (pen.visits_used ?? 0) as never;
      out.package_start_date = pick(pen.start_date, c.pending_renewal_start_date ?? null) as never;
      // The raw prepared row this override consumed is gone; a LATER raw
      // preparation (after the started package) is a genuine new renewal.
      const rawPen = c.pending_renewal_start_date ?? null;
      const startedOn = String(out.package_start_date ?? "");
      if (!rawPen || !startedOn || rawPen <= startedOn) {
        out.pending_renewal_start_date = null as never;
        out.pending_renewal_total_visits = null as never;
        out.pending_renewal_price = null as never;
        out.pending_renewal_paid = 0 as never;
      }
      flags.push(pen.square_booking_id
        ? "Prepared renewal started by verified Square 1/N"
        : "Prepared renewal started by admin override (not by Square 1/N)");
    } else if (pen.status === "completed") {
      flags.push("Pending package override marked completed — ignored; use current or prior package");
    } else {
      out.pending_renewal_total_visits = pick(pen.total_visits, c.pending_renewal_total_visits ?? null) as never;
      out.pending_renewal_price = pick(pen.price, c.pending_renewal_price ?? null) as never;
      out.pending_renewal_paid = pick(pen.recognized_paid, c.pending_renewal_paid ?? 0) as never;
      out.pending_renewal_start_date = pick(pen.start_date, c.pending_renewal_start_date ?? null) as never;
      if (!out.pending_renewal_start_date) flags.push("Prepared renewal override needs a start date");
    }
  }
  // Admin figures drive visit position (Hub mode) only when an admin set an
  // explicit visit count on the package in force, or started a prepared package
  // by hand. Financial/date-only edits and Square-started packages keep Square
  // as the source of visit numbers. (Activation is still held by blocksAutoActivation.)
  applyNewPayments(c, out, overrides, { cur, pen, prev, promoted });
  const penActive = pen?.status === "active";
  const manualCount = penActive ? !pen!.square_booking_id : !!cur && cur.visits_used !== null;
  if (manualCount) out.visit_tracking_mode = "hub" as never;
  return { ...out, override_flags: flags, has_override: overrides.length > 0 };
}

/**
 * Payments recorded after the latest override write (raw money moved since its
 * baseline) are added on top of the admin figures, for the money fields the
 * overrides mask only, oldest debt first: prior → current → prepared. Unmasked
 * fields already show raw payments, so nothing is counted twice.
 */
function applyNewPayments(c: RawPackageFields, out: RawPackageFields, overrides: PackageOverride[], s: { cur?: PackageOverride; pen?: PackageOverride; prev?: PackageOverride; promoted: boolean }) {
  const withB = overrides.filter((o) => o.raw_baseline);
  const prevMasked = !!s.prev;
  const curMasked = (!!s.cur && s.cur.recognized_paid !== null) || s.pen?.status === "active";
  const penMasked = s.promoted || (!!s.pen && s.pen.status !== "completed" && (s.pen.status === "active" || s.pen.recognized_paid !== null));
  // Under a Square-promoted package, raw prepaid at promotion was consumed or stale.
  if (s.promoted && !(s.pen && s.pen.status === "prepared" && s.pen.recognized_paid !== null)) out.pending_renewal_paid = 0 as never;
  if (!withB.length) return;
  const b = [...withB].sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")))[0].raw_baseline!;
  let pool =
    (curMasked ? n(c.amount_paid) - n(b.amount_paid) : 0) +
    (penMasked ? n(c.pending_renewal_paid) - n(b.pending_paid) : 0) +
    (prevMasked ? n(b.prev_owed) - n(c.previous_package_owed) : 0);
  if (!(pool > 0)) return;
  if (prevMasked) {
    const t = Math.min(pool, n(out.previous_package_owed));
    out.previous_package_owed = (n(out.previous_package_owed) - t) as never;
    pool -= t;
  }
  if (curMasked && pool > 0) {
    const t = Math.min(pool, Math.max(0, n(out.package_price) - n(out.amount_paid)));
    out.amount_paid = (n(out.amount_paid) + t) as never;
    pool -= t;
  }
  if (penMasked && pool > 0 && out.pending_renewal_start_date) {
    out.pending_renewal_paid = (n(out.pending_renewal_paid) + pool) as never;
    pool = 0;
  }
  if (pool > 0) out.amount_paid = (n(out.amount_paid) + pool) as never; // overpayment stays visible as credit-on-current
}

/** Overrides block automatic renewal activation so Square/check-in can't silently replace admin figures. */
export function blocksAutoActivation(overrides: Pick<PackageOverride, "slot">[]): boolean {
  return overrides.some((o) => o.slot === "current" || o.slot === "pending");
}

/** Status/paid changes are consequential and need a confirmation step. */
export function needsConfirmation(before: Partial<PackageOverride>, after: PackageOverride): boolean {
  return (before.status ?? null) !== after.status || n(before.recognized_paid) !== n(after.recognized_paid);
}

/** Apply each client's active overrides to a list of rows (by `id`). */
export function applyOverridesToRows<T extends RawPackageFields & { id: string }>(rows: T[], all: (PackageOverride & { client_id: string })[]): T[] {
  if (!all.length) return rows;
  return rows.map((r) => {
    const mine = all.filter((o) => o.client_id === r.id);
    return mine.length ? (applyOverrides(r, mine) as T) : r;
  });
}
