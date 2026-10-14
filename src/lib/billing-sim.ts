/**
 * Read-only billing-model simulator for pay-per-visit and weekly clients.
 * Pure — no I/O, writes nothing. Does not change Master Dues rules; it only
 * produces open obligations that a caller may add to (or swap into) a
 * Master Dues comparison.
 *
 * Window: previous `lookbackWeeks` work weeks + current week + next week.
 * Past unpaid obligations stay Due Now; future ones count through next week.
 * Later appointments are informational only.
 */
import { addDaysYmd, workWeekStartFromYmd } from "./work-week";

export type BillingType = "package" | "pay_per_visit" | "weekly";
export type SimAppointment = { id: string; start_iso: string; ymd: string; status?: string | null };
export type SimPayment = { id: string; at_iso: string; amount: number };

export type SimObligation = {
  key: string;
  kind: "visit" | "week";
  ymd: string; // appointment date or week start
  amount: number;
  applied: number;
  open: number;
  status: "upcoming" | "due_now" | "paid" | "needs_billing_review";
  expected: "past" | "this_week" | "next_week";
  reason: string;
};
export type SimInfo = { ymd: string; kind: "cancelled" | "no_show" | "beyond_horizon"; reason: string };
export type SimPaymentNote = { payment_id: string; amount: number; kind: "unclear" | "overpayment"; reason: string };

export type SimInput = {
  type: BillingType;
  rate: number | null;
  appointments: SimAppointment[];
  payments: SimPayment[];
  todayYmd: string;
  nowIso: string;
  lookbackWeeks?: number;
  /** Billing effective date: nothing before its work week is reconstructed (overrides lookbackWeeks). */
  windowStartYmd?: string | null;
  /** No payment records exist for this client at all (likely paid outside Square). */
  paymentRecordsMissing?: boolean;
};

export type SimResult =
  | { setup: "needs_billing_setup"; reason: string; obligations: []; info: []; payments: []; open: 0 }
  | {
      setup: "ok";
      obligations: SimObligation[];
      info: SimInfo[];
      payments: SimPaymentNote[];
      /** Open dollars that count toward Master Dues (excludes needs_billing_review). */
      open: number;
      reviewOpen: number;
    };

const r2 = (n: number) => Math.round(n * 100) / 100;
const CANCELLED = /CANCEL|DECLINE/i;
const NO_SHOW = /NO_SHOW/i;

export function simulateBilling(inp: SimInput): SimResult {
  const rate = Number(inp.rate ?? 0);
  if (inp.type === "package" || !(rate > 0))
    return { setup: "needs_billing_setup", reason: inp.type === "package" ? "Not a PPV/weekly client" : "No reliable rate", obligations: [], info: [], payments: [], open: 0 };

  const thisWk = workWeekStartFromYmd(inp.todayYmd);
  const nextWk = addDaysYmd(thisWk, 7);
  const winStart = inp.windowStartYmd ? workWeekStartFromYmd(inp.windowStartYmd) : addDaysYmd(thisWk, -7 * (inp.lookbackWeeks ?? 4));
  const horizonEnd = addDaysYmd(nextWk, 7); // exclusive
  const expectedFor = (wk: string): SimObligation["expected"] => (wk < thisWk ? "past" : wk === thisWk ? "this_week" : "next_week");
  const nowMs = new Date(inp.nowIso).getTime();

  const info: SimInfo[] = [];
  const obligations: SimObligation[] = [];
  const appts = [...inp.appointments].sort((a, b) => a.start_iso.localeCompare(b.start_iso));
  const weeks = new Map<string, number>();
  for (const a of appts) {
    const wk = workWeekStartFromYmd(a.ymd);
    if (wk < winStart) continue;
    if (wk >= horizonEnd) { info.push({ ymd: a.ymd, kind: "beyond_horizon", reason: "After next week — informational only" }); continue; }
    if (CANCELLED.test(a.status ?? "")) { info.push({ ymd: a.ymd, kind: "cancelled", reason: "Cancelled — no charge" }); continue; }
    if (NO_SHOW.test(a.status ?? "")) { info.push({ ymd: a.ymd, kind: "no_show", reason: "No-show — exception, no rule" }); continue; }
    if (inp.type === "pay_per_visit") {
      const started = new Date(a.start_iso).getTime() <= nowMs;
      obligations.push({ key: a.id, kind: "visit", ymd: a.ymd, amount: rate, applied: 0, open: rate, status: started ? "due_now" : "upcoming", expected: expectedFor(wk), reason: started ? "Visit has started" : "Visit not started yet" });
    } else {
      weeks.set(wk, (weeks.get(wk) ?? 0) + 1);
    }
  }
  for (const [wk, n] of [...weeks.entries()].sort()) {
    obligations.push({ key: `week:${wk}`, kind: "week", ymd: wk, amount: rate, applied: 0, open: rate, status: wk <= thisWk ? "due_now" : "upcoming", expected: expectedFor(wk), reason: `${n} visit(s) in week of ${wk}` });
  }
  obligations.sort((a, b) => a.ymd.localeCompare(b.ymd));

  // Payments: only clearly attributable ones (whole multiples of the rate,
  // inside the window). Oldest open obligation first; never floating credit.
  const notes: SimPaymentNote[] = [];
  let unclearBefore: string | null = null;
  const pays = [...inp.payments].sort((a, b) => a.at_iso.localeCompare(b.at_iso));
  for (const p of pays) {
    if (p.at_iso.slice(0, 10) < winStart) continue;
    const amt = r2(Number(p.amount));
    const multiple = amt / rate;
    if (!(amt > 0) || Math.abs(multiple - Math.round(multiple)) > 1e-6) {
      notes.push({ payment_id: p.id, amount: amt, kind: "unclear", reason: `$${amt} is not a multiple of the $${rate} rate` });
      if (!unclearBefore || p.at_iso > unclearBefore) unclearBefore = p.at_iso;
      continue;
    }
    let left = amt;
    for (const o of obligations) {
      if (left <= 0) break;
      if (o.open <= 0) continue;
      const take = Math.min(o.open, left);
      o.applied = r2(o.applied + take);
      o.open = r2(o.open - take);
      left = r2(left - take);
    }
    if (left > 0) notes.push({ payment_id: p.id, amount: left, kind: "overpayment", reason: "Exceeds simulated obligations — reported, not credit" });
  }
  for (const o of obligations) {
    if (o.open <= 0) { o.status = "paid"; continue; }
    if (inp.paymentRecordsMissing && o.expected === "past") {
      o.status = "needs_billing_review";
      o.reason += "; no payment records for this client";
    } else if (unclearBefore && o.ymd <= unclearBefore.slice(0, 10)) {
      o.status = "needs_billing_review";
      o.reason += "; an unclear payment may cover this";
    }
  }
  const open = r2(obligations.filter((o) => o.status === "due_now" || o.status === "upcoming").reduce((s, o) => s + o.open, 0));
  const reviewOpen = r2(obligations.filter((o) => o.status === "needs_billing_review").reduce((s, o) => s + o.open, 0));
  return { setup: "ok", obligations, info, payments: notes, open, reviewOpen };
}

/**
 * Projected Master Dues = current − replaced + simulated open.
 * `replaced` is only the package-model dollars explicitly being swapped
 * (never previous debt or unrelated balances), so nobody counts twice.
 */
export function projectMasterDues(currentTotal: number, entries: { replaced: number; simulatedOpen: number }[]) {
  const replaced = r2(entries.reduce((s, e) => s + e.replaced, 0));
  const added = r2(entries.reduce((s, e) => s + e.simulatedOpen, 0));
  const projected = r2(currentTotal - replaced + added);
  return { current: r2(currentTotal), replaced, added, projected, difference: r2(projected - (currentTotal - replaced + added)) };
}
