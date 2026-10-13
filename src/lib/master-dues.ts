/**
 * Master dues: one row per client, three independent money buckets, each with
 * its own obligation status and timing. Pure — no I/O. Not wired to UI yet.
 *
 * - Previous / current balances are already owed → always "due_now".
 *   Square scheduling only sets a separate expected-collection window.
 * - Prepared renewal balance = max(0, pending_renewal_price - pending_renewal_paid).
 *   Its status comes from the Square-driven renewal timing supplied by the
 *   caller — never from the stored renewal date alone:
 *     started  → due_now  (concrete Square evidence the next package began)
 *     upcoming → upcoming (first uncovered appointment booked in the future)
 *     no_start → prepared (nothing booked past the current package)
 *     unknown  → needs_review (package boundary can't be determined)
 * - Missing package price is a package-info exception, never a $0 balance.
 */
import { addDaysYmd, workWeekStartFromYmd } from "./work-week";

export type MasterDuesClient = {
  id: string;
  first_name: string;
  last_name: string;
  status?: string | null;
  deleted_at?: string | null;
  payment_model?: string | null;
  package_total_visits?: number | null;
  package_price?: number | null;
  amount_paid?: number | null;
  previous_package_owed?: number | null;
  pending_renewal_start_date?: string | null;
  pending_renewal_price?: number | null;
  pending_renewal_paid?: number | null;
};

export type RenewalTiming = {
  kind: "started" | "upcoming" | "no_start" | "unknown";
  /** Effective date: first uncovered appointment / observed new-package start. */
  ymd: string | null;
  reason?: string;
};

export type ObligationStatus = "due_now" | "upcoming" | "prepared" | "needs_review" | "none";
export type CollectionWindow = "this_week" | "next_week" | "later" | "unknown";

export type MasterDuesRow = {
  client_id: string;
  name: string;
  previous: { amount: number; status: ObligationStatus };
  current: { amount: number; status: ObligationStatus; expected: CollectionWindow | null };
  renewal: { amount: number; status: ObligationStatus; expected_ymd: string | null };
  total: number;
  reasons: string[];
};

export type MasterDuesException = {
  client_id: string;
  name: string;
  kind: "package_info_needed" | "pay_per_visit";
  reason: string;
};

export type MasterDuesCtx = {
  todayYmd: string;
  /** Next non-cancelled Square appointment date per client (YYYY-MM-DD). */
  nextAppointmentYmd: Map<string, string>;
  /** Square-driven renewal timing per client; missing → unknown. */
  renewalTiming: Map<string, RenewalTiming>;
  /** Clients with numbered Square package appointments (e.g. "1 of 8"). */
  squareNumberedPackage?: Set<string>;
};

/**
 * Assessment-status clients count only with clear package evidence: a priced
 * multi-visit package, or numbered Square package appointments. A price alone
 * (e.g. a one-off assessment fee) is not enough.
 */
export function assessmentHasPackage(c: MasterDuesClient, squareNumbered: boolean): boolean {
  if (squareNumbered) return true;
  return (c.package_total_visits ?? 0) > 1 && Number(c.package_price ?? 0) > 0;
}

/**
 * Renewal timing from the first uncovered appointment's actual start time.
 * It is "started" only once that moment has passed — a later-today
 * appointment is still upcoming.
 */
export function timingFromUncovered(startIso: string, nowIso: string, ymd: string): RenewalTiming {
  return new Date(startIso).getTime() <= new Date(nowIso).getTime()
    ? { kind: "started", ymd, reason: `First uncovered appointment ${startIso} has started` }
    : { kind: "upcoming", ymd, reason: `First uncovered appointment ${startIso}` };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: unknown) => Math.max(0, r2(Number(n ?? 0)));

export function windowFor(ymd: string | null | undefined, todayYmd: string): CollectionWindow {
  if (!ymd) return "unknown";
  const thisStart = workWeekStartFromYmd(todayYmd);
  const nextStart = addDaysYmd(thisStart, 7);
  const wk = workWeekStartFromYmd(ymd);
  if (wk <= thisStart) return "this_week";
  if (wk === nextStart) return "next_week";
  return "later";
}

const RENEWAL_STATUS: Record<RenewalTiming["kind"], ObligationStatus> = {
  started: "due_now",
  upcoming: "upcoming",
  no_start: "prepared",
  unknown: "needs_review",
};

export function computeMasterDues(clients: MasterDuesClient[], ctx: MasterDuesCtx) {
  const rows: MasterDuesRow[] = [];
  const exceptions: MasterDuesException[] = [];
  const seen = new Set<string>();

  for (const c of clients) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.deleted_at || c.status === "archived") continue;
    if (c.status === "assessment" && !assessmentHasPackage(c, !!ctx.squareNumberedPackage?.has(c.id))) continue;
    const name = `${c.first_name} ${c.last_name}`.trim();
    const reasons: string[] = [];

    const prev = money(c.previous_package_owed);
    let cur = 0;
    if (c.payment_model === "pay_per_visit") {
      exceptions.push({ client_id: c.id, name, kind: "pay_per_visit", reason: "Pay-per-visit: no per-visit amount stored" });
    } else if (!(Number(c.package_price ?? 0) > 0)) {
      if ((c.package_total_visits ?? 0) > 0)
        exceptions.push({ client_id: c.id, name, kind: "package_info_needed", reason: "Package has no price" });
    } else {
      cur = money(Number(c.package_price) - Number(c.amount_paid ?? 0));
    }

    const renPrice = Number(c.pending_renewal_price ?? 0);
    const ren = renPrice > 0 ? money(renPrice - Number(c.pending_renewal_paid ?? 0)) : 0;
    let renStatus: ObligationStatus = "none";
    let renYmd: string | null = null;
    if (ren > 0) {
      const t = ctx.renewalTiming.get(c.id) ?? { kind: "unknown" as const, ymd: null, reason: "No renewal timing available" };
      renStatus = RENEWAL_STATUS[t.kind];
      renYmd = t.ymd;
      if (t.reason) reasons.push(`Renewal: ${t.reason}`);
    }

    const total = r2(prev + cur + ren);
    if (total <= 0) continue;
    const nextAppt = ctx.nextAppointmentYmd.get(c.id) ?? null;
    if (prev > 0) reasons.push("Debt from an earlier package");
    if (cur > 0 && !nextAppt) reasons.push("Current balance; no upcoming appointment");

    rows.push({
      client_id: c.id,
      name,
      previous: { amount: prev, status: prev > 0 ? "due_now" : "none" },
      current: {
        amount: cur,
        status: cur > 0 ? "due_now" : "none",
        expected: cur > 0 ? windowFor(nextAppt, ctx.todayYmd) : null,
      },
      renewal: { amount: ren, status: renStatus, expected_ymd: renYmd },
      total,
      reasons,
    });
  }

  const tally = (pick: (r: MasterDuesRow) => { amount: number; ok: boolean }) => {
    let dollars = 0;
    let clients = 0;
    for (const r of rows) {
      const p = pick(r);
      if (p.ok && p.amount > 0) { dollars += p.amount; clients++; }
    }
    return { clients, dollars: r2(dollars) };
  };
  const renewalBy = (s: ObligationStatus) => tally((r) => ({ amount: r.renewal.amount, ok: r.renewal.status === s }));
  const currentBy = (w: CollectionWindow) => tally((r) => ({ amount: r.current.amount, ok: r.current.expected === w }));

  const totals = {
    clients: rows.length,
    total: r2(rows.reduce((s, r) => s + r.total, 0)),
    previous: tally((r) => ({ amount: r.previous.amount, ok: true })),
    current: tally((r) => ({ amount: r.current.amount, ok: true })),
    renewal: tally((r) => ({ amount: r.renewal.amount, ok: true })),
    multiBucket: rows.filter((r) => [r.previous, r.current, r.renewal].filter((b) => b.amount > 0).length > 1).length,
    renewalByStatus: {
      due_now: renewalBy("due_now"),
      upcoming: renewalBy("upcoming"),
      prepared: renewalBy("prepared"),
      needs_review: renewalBy("needs_review"),
    },
    currentByWindow: {
      this_week: currentBy("this_week"),
      next_week: currentBy("next_week"),
      later: currentBy("later"),
      unknown: currentBy("unknown"),
    },
  };
  const unexplained = r2(totals.total - (totals.previous.dollars + totals.current.dollars + totals.renewal.dollars));
  return { rows, exceptions, totals, unexplained };
}
