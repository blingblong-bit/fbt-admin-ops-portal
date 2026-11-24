/**
 * Upcoming 1/x visits for the dues screens. Pure — no I/O, never adds money
 * to what anyone owes. A future, non-cancelled Square booking whose note reads
 * "1 of N" becomes one review row in the Mon–Sun week of that booking. Visits
 * left on the old package play no part. Approval (admin OK) only prepares the
 * renewal through the existing audited prepared-renewal path; the amount is
 * owed once Square activation starts the package.
 */
import { parseVisitNote } from "./square-visit-audit";
import { addDaysYmd, ymdWeekday } from "./work-week";

export type UpcomingBooking = { id: string; start_at?: string | null; status?: string | null; seller_note?: string | null; customer_note?: string | null };
export type UpcomingClient = {
  id: string; first_name?: string | null; last_name?: string | null; square_customer_id?: string | null;
  package_price?: number | string | null;
  pending_renewal_start_date?: string | null; pending_renewal_total_visits?: number | null; pending_renewal_price?: number | string | null; pending_renewal_paid?: number | string | null;
};
export type UpcomingFirstVisit = {
  client_id: string; name: string; booking_id: string; start_iso: string; ymd: string; week_start: string;
  total_visits: number; price: number | null; paid: number; remaining: number | null; status: "needs_review" | "approved";
};

const chi = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Monday of the Mon–Sun week containing ymd. */
export function mondayOf(ymd: string): string {
  const dow = ymdWeekday(ymd);
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}

export function findUpcomingFirstVisits(clients: UpcomingClient[], byCustomer: Map<string, UpcomingBooking[]>, nowIso: string): UpcomingFirstVisit[] {
  const now = Date.parse(nowIso);
  const out: UpcomingFirstVisit[] = [];
  for (const c of clients) {
    if (!c.square_customer_id) continue;
    const first = (byCustomer.get(c.square_customer_id) ?? [])
      .filter((b) => b.start_at && Date.parse(b.start_at) > now && !/CANCEL|DECLINE|NO_SHOW/i.test(b.status ?? ""))
      .map((b) => ({ b, note: parseVisitNote(b.seller_note) ?? parseVisitNote(b.customer_note) }))
      .filter((x) => x.note?.n === 1)
      .sort((x, y) => Date.parse(x.b.start_at!) - Date.parse(y.b.start_at!))[0];
    if (!first) continue;
    const ymd = chi(first.b.start_at!);
    const total = first.note!.total;
    const hasPrepared = !!c.pending_renewal_start_date && c.pending_renewal_price != null;
    const approved = hasPrepared && c.pending_renewal_start_date === ymd && Number(c.pending_renewal_total_visits) === total;
    const raw = hasPrepared ? Number(c.pending_renewal_price) : c.package_price != null ? Number(c.package_price) : NaN;
    out.push({
      client_id: c.id, name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Client",
      booking_id: first.b.id, start_iso: first.b.start_at!, ymd, week_start: mondayOf(ymd), total_visits: total,
      price: Number.isFinite(raw) && raw > 0 ? r2(raw) : null,
      paid: approved ? r2(Math.max(0, Number(c.pending_renewal_paid ?? 0))) : 0,
      remaining: Number.isFinite(raw) && raw > 0 ? r2(Math.max(0, raw - (approved ? Math.max(0, Number(c.pending_renewal_paid ?? 0)) : 0))) : null,
      status: approved ? "approved" : "needs_review",
    });
  }
  return out.sort((a, b) => a.start_iso.localeCompare(b.start_iso));
}

/** Weekly summary line. Kept separate from (never added to) the Owes total. */
export function upcomingWeekSummary(items: UpcomingFirstVisit[], weekStart: string) {
  const inWeek = items.filter((i) => i.week_start === weekStart);
  return { items: inWeek, dollars: r2(inWeek.reduce((a, i) => a + (i.remaining ?? 0), 0)), needReview: inWeek.filter((i) => i.status === "needs_review").length };
}

/** Current-package money above its price. Money held on an approved renewal is not overpaid. Never credit. */
export function overpaidAmount(c: { package_price?: number | string | null; amount_paid?: number | string | null; pending_renewal_paid?: number | string | null }): number {
  const price = Number(c.package_price ?? 0);
  return r2(price > 0 ? Math.max(0, Number(c.amount_paid ?? 0) - price) : 0);
}

export type ProfileRenewal =
  | { kind: "upcoming"; item: UpcomingFirstVisit; prepared: PreparedInfo | null }
  | { kind: "prepared"; prepared: PreparedInfo }
  | { kind: "none" };
export type PreparedInfo = { startYmd: string | null; totalVisits: number | null; price: number | null; paid: number };

/** Profile "Upcoming renewal" selection for one client. Pure; never hides a prepared renewal. */
export function selectProfileRenewal(c: UpcomingClient, bookings: UpcomingBooking[], nowIso: string): ProfileRenewal {
  const hasPrepared = !!c.pending_renewal_start_date || c.pending_renewal_price != null || c.pending_renewal_total_visits != null;
  const prepared: PreparedInfo | null = hasPrepared ? {
    startYmd: c.pending_renewal_start_date ?? null,
    totalVisits: c.pending_renewal_total_visits ?? null,
    price: c.pending_renewal_price != null ? Number(c.pending_renewal_price) : null,
    paid: r2(Math.max(0, Number(c.pending_renewal_paid ?? 0))),
  } : null;
  const map = new Map<string, UpcomingBooking[]>();
  if (c.square_customer_id) map.set(c.square_customer_id, bookings);
  const item = findUpcomingFirstVisits([c], map, nowIso)[0];
  if (item) return { kind: "upcoming", item, prepared };
  if (prepared) return { kind: "prepared", prepared };
  return { kind: "none" };
}
