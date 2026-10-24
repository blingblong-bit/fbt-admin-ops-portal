// Pure decision: has Square already started a client's prepared renewal?
// Evidence must be a PAST, live (accepted/completed) "1 of N" on or after the
// prepared "can start on or after" date, with a clean sequence after it.
// Future bookings, cancellations/no-shows, dates alone, payments alone,
// conflicting numbers or Square errors never activate.
import type { SequenceEntry } from "./square-visit-audit";

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
 * A prepared package held in an admin override (financial/date-only) started
 * in Square. Same evidence bar as decideSquareActivation, applied to the
 * EFFECTIVE prepared start/size. Never for an admin visit-count override or an
 * already-started override. Pure.
 */
export function decideOverridePendingStart(i: {
  clientId: string;
  squareCustomerId: string | null;
  rawPending: { start: string | null; total: number | null };
  overrides: { slot: string; status: string; visits_used: number | null; start_date: string | null; total_visits: number | null }[];
  seq: SequenceEntry[] | null;
  currentUnreadable: boolean;
}): SquareActivationDecision {
  const pen = i.overrides.find((o) => o.slot === "pending");
  const cur = i.overrides.find((o) => o.slot === "current");
  if (!pen || pen.status !== "prepared") return { kind: "skip", reason: "No prepared package override waiting to start" };
  if (cur && cur.visits_used !== null) return { kind: "skip", reason: "Current package has an admin visit count" };
  const d = decideSquareActivation({
    client: {
      id: i.clientId,
      square_customer_id: i.squareCustomerId,
      pending_renewal_start_date: pen.start_date ?? i.rawPending.start,
      pending_renewal_total_visits: pen.total_visits ?? i.rawPending.total,
    },
    seq: i.seq, currentUnreadable: i.currentUnreadable, hasOverride: false, sinceYmd: "0000-00-00",
  });
  return d;
}
