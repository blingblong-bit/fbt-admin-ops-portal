// Pure decision: has Square already started a client's prepared renewal?
// Evidence must be a PAST, live (accepted/completed) "1 of N" on or after the
// prepared "can start on or after" date, with a clean sequence after it.
// Future bookings, cancellations/no-shows, dates alone, payments alone,
// conflicting numbers or Square errors never activate.
import type { SequenceEntry } from "./square-visit-audit";
import { applyOverrides, type PackageOverride, type RawPackageFields } from "./package-override";

export type ActivationClient = {
  id: string;
  square_customer_id: string | null;
  pending_renewal_start_date: string | null;
  pending_renewal_total_visits: number | null;
};

export type SquareActivationDecision =
  | { kind: "activate" | "backlog"; reason: string; bookingId: string; startYmd: string; visitsUsed: number; total: number }
  | { kind: "ambiguous" | "not_ready" | "skip"; reason: string };

const LIVE = /^(ACCEPTED|COMPLETED)$/i;
const ymd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export function decideSquareActivation(i: {
  client: ActivationClient;
  seq: SequenceEntry[] | null; // null = Square lookup failed
  currentUnreadable: boolean;
  hasOverride: boolean;
  /** 1/N openers before this date are historical backlog: reported, never auto-activated. */
  sinceYmd: string;
}): SquareActivationDecision {
  const c = i.client;
  if (!c.pending_renewal_start_date) return { kind: "skip", reason: "No prepared renewal" };
  if (i.hasOverride) return { kind: "skip", reason: "Admin package override active" };
  if (!c.square_customer_id) return { kind: "not_ready", reason: "Not linked to Square" };
  if (!i.seq) return { kind: "not_ready", reason: "Square lookup failed" };
  const gate = c.pending_renewal_start_date;
  const live = i.seq.filter((e) => e.past && !e.cancelled && LIVE.test(e.status ?? "") && e.note && ymd(e.date) >= gate);
  const openers = live.filter((e) => e.note!.n === 1);
  if (openers.length === 0) return { kind: "not_ready", reason: "No completed Square 1-of-N on or after the prepared start" };
  if (i.currentUnreadable) return { kind: "ambiguous", reason: "Current Square position is unclear" };
  if (openers.length > 1) return { kind: "ambiguous", reason: "More than one Square 1-of-N since the prepared start" };
  const o = openers[0];
  const total = o.note!.total;
  if (c.pending_renewal_total_visits && total !== Number(c.pending_renewal_total_visits))
    return { kind: "ambiguous", reason: `Square says 1 of ${total}, prepared renewal is ${c.pending_renewal_total_visits} visits` };
  const after = live.filter((e) => e.date >= o.date);
  // Same-day different numbers, or a sequence that doesn't run 1,2,3… of the same size.
  for (let k = 0; k < after.length; k++) {
    const n = after[k].note!;
    if (n.total !== total || n.n !== k + 1) return { kind: "ambiguous", reason: "Square numbering after the 1-of-N is not a clean sequence" };
  }
  const base = { bookingId: o.booking_id, startYmd: ymd(o.date), visitsUsed: after.length, total };
  if (base.startYmd < i.sinceYmd) return { kind: "backlog", reason: "Started in Square before automatic activation was turned on", ...base };
  return { kind: "activate", reason: `Square marked ${base.startYmd} as 1 of ${total}`, ...base };
}

/**
 * Clients whose package figures are admin financial/date-only overrides: has
 * Square started their next package (override-prepared, or a later raw
 * preparation)? Same evidence bar as decideSquareActivation, on the EFFECTIVE
 * prepared start/size. Never for an admin visit count or an admin-started
 * package. Returns the figures start_pending_override_from_square validates
 * and writes, computed by applyOverrides (single money source). Pure.
 */
export type PromotionFigures = {
  gate: string; total: number; price: number; recognized_paid: number; prev_owed: number;
  expect_current_id: string | null; expect_pending_id: string | null;
};
export function decideOverridePendingStart(i: {
  client: RawPackageFields & { id: string; square_customer_id: string | null };
  overrides: (PackageOverride & { id?: string })[];
  seq: SequenceEntry[] | null;
  currentUnreadable: boolean;
}): SquareActivationDecision & { figures?: PromotionFigures } {
  const pen = i.overrides.find((o) => o.slot === "pending");
  const cur = i.overrides.find((o) => o.slot === "current");
  if (!pen && !cur) return { kind: "skip", reason: "No package override" };
  if (cur && cur.visits_used !== null) return { kind: "skip", reason: "Current package has an admin visit count" };
  if (pen && pen.status !== "prepared") return { kind: "skip", reason: "Prepared package was started or closed by an admin" };
  const eff = applyOverrides(i.client, i.overrides);
  if (!eff.pending_renewal_start_date) return { kind: "skip", reason: "No prepared renewal" };
  const total = Number(eff.pending_renewal_total_visits ?? 0) || null;
  const d = decideSquareActivation({
    client: { id: i.client.id, square_customer_id: i.client.square_customer_id, pending_renewal_start_date: eff.pending_renewal_start_date, pending_renewal_total_visits: total },
    seq: i.seq, currentUnreadable: i.currentUnreadable, hasOverride: false, sinceYmd: "0000-00-00",
  });
  if (d.kind !== "activate" && d.kind !== "backlog") return d;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    ...d,
    figures: {
      gate: eff.pending_renewal_start_date, total: d.total,
      price: num(eff.pending_renewal_price), recognized_paid: num(eff.pending_renewal_paid),
      prev_owed: num(eff.previous_package_owed) + Math.max(0, num(eff.package_price) - num(eff.amount_paid)),
      expect_current_id: cur?.id ?? null, expect_pending_id: pen?.id ?? null,
    },
  };
}
