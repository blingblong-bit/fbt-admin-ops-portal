// Pure renewal forecast: the exact row-building used by getRenewalForecast,
// split out so the full lifecycle (Scheduled -> Square start -> absent ->
// reappears) is testable with fixture bookings and a fixed clock.
import { renewalAmountDue } from "@/lib/dues-messaging";
import {
  currentPackageAlreadyCovers,
  currentPositionUnreadable,
  drivingCounts,
  forecastRenewal,
  resolveEffectiveVisitState,
} from "@/lib/effective-visit-state";
import { applyOverridesToRows, type PackageOverride } from "@/lib/package-override";
import { decideSquareActivation } from "@/lib/square-activation";
import { buildSequence, detectNoteIssues } from "@/lib/square-visit-audit";
import { chicagoYmd, workWeekStartFromYmd } from "@/lib/work-week";
import type { RenewalForecastRow } from "@/lib/schedule.functions";

export type ForecastBooking = { id: string; start_at?: string | null; status?: string | null; seller_note?: string | null; customer_note?: string | null };

export type ForecastClient = {
  id: string;
  square_customer_id: string | null;
  visit_tracking_mode?: string | null;
  visits_used: number | null;
  package_total_visits: number | null;
  package_price: number | string | null;
  package_start_date?: string | null;
  next_package_price: number | string | null;
  pending_renewal_start_date: string | null;
  pending_renewal_price: number | string | null;
  pending_renewal_paid?: number | string | null;
  pending_renewal_total_visits: number | null;
  pending_renewal_package_name: string | null;
};

const ymd = (iso: string) => chicagoYmd(new Date(iso));

export function upcomingFrom(bookings: ForecastBooking[], nowIso: string): string[] {
  return bookings
    .filter((b) => b.start_at && b.start_at >= nowIso && !/CANCEL|DECLINE|NO_SHOW/i.test(b.status ?? ""))
    .map((b) => b.start_at!)
    .sort();
}

/**
 * clients: every non-archived client (raw rows). Overrides are applied here.
 * bookingsByCustomer: Square bookings (past + future) per customer.
 */
export function buildRenewalForecastRows(i: {
  clients: ForecastClient[];
  overrides: (PackageOverride & { client_id: string })[];
  bookingsByCustomer: Map<string, ForecastBooking[]>;
  nowIso: string;
  weekStartYmd: string;
  nextWeekStartYmd: string;
}): RenewalForecastRow[] {
  const { nowIso, weekStartYmd, nextWeekStartYmd } = i;
  const bucket = (y: string | null) => {
    const b = y ? workWeekStartFromYmd(y) : null;
    return b === weekStartYmd ? "this" : b === nextWeekStartYmd ? "next" : "later";
  };
  const eff = applyOverridesToRows(i.clients as never[], i.overrides) as unknown as ForecastClient[];
  const bookingsOf = (c: ForecastClient) => (c.square_customer_id ? i.bookingsByCustomer.get(c.square_customer_id) ?? [] : []);
  const live = (bs: ForecastBooking[]) => bs.filter((b) => b.start_at).map((b) => ({ ...b, start_at: b.start_at! }));

  /** Square already opened this prepared package (verified past 1/N on/after its start). */
  const squareStartedYmd = (c: ForecastClient): string | null => {
    if (!c.pending_renewal_start_date || !c.square_customer_id) return null;
    const seq = buildSequence(live(bookingsOf(c)) as never, nowIso);
    const d = decideSquareActivation({
      client: c as never, seq, hasOverride: false, sinceYmd: "0000-00-00",
      currentUnreadable: currentPositionUnreadable(seq, detectNoteIssues(seq)),
    });
    return d.kind === "activate" || d.kind === "backlog" ? d.startYmd : null;
  };

  const pricing = (r: ForecastClient) => {
    const basePrice = Number(r.package_price ?? 0);
    const override = r.next_package_price === null || r.next_package_price === undefined ? null : Number(r.next_package_price);
    const pendingPrice = r.pending_renewal_price === null || r.pending_renewal_price === undefined ? null : Number(r.pending_renewal_price);
    return {
      package_price: basePrice,
      next_package_price:
        pendingPrice !== null
          ? renewalAmountDue({ pending_renewal_price: pendingPrice, pending_renewal_paid: r.pending_renewal_paid ?? 0 } as never)
          : (override ?? basePrice),
    };
  };

  const out: RenewalForecastRow[] = [];
  for (const r of eff) {
    if (!(Number(r.package_total_visits ?? 0) > 0) || r.visits_used === null || r.visits_used === undefined) continue;
    const starts = upcomingFrom(bookingsOf(r), nowIso);
    if (starts.length === 0) continue;
    const state = resolveEffectiveVisitState(r, live(bookingsOf(r)), nowIso);
    const drive = drivingCounts(state);
    const fc = forecastRenewal({ upcomingStarts: starts, visitsUsed: drive.used, totalVisits: drive.total, nextPackageStart: drive.nextPackageStart });
    if (!fc.needsRenewal || !fc.firstUncoveredStart) continue;
    const firstUncoveredYmd = ymd(fc.firstUncoveredStart);
    const pendingStart = r.pending_renewal_start_date;
    if (!pendingStart && currentPackageAlreadyCovers(r.package_start_date, r.visits_used, firstUncoveredYmd)) continue;
    const started = squareStartedYmd(r);
    out.push({
      client_id: r.id,
      visits_used: drive.used,
      package_total_visits: drive.total,
      remaining: fc.remaining,
      upcoming_count: starts.length,
      appointment_ymds: starts.map(ymd),
      first_uncovered_index: fc.firstUncoveredIndex,
      first_uncovered_ymd: firstUncoveredYmd,
      visit_source: state.source,
      review_status: state.reviewStatus,
      automation_usable: state.automationUsable,
      hub_visits_used: r.visits_used ?? null,
      week_bucket: bucket(pendingStart ?? firstUncoveredYmd),
      ...pricing(r),
      pre_renewed: !!pendingStart,
      pending_start_ymd: pendingStart,
      pending_total_visits: r.pending_renewal_total_visits ?? null,
      pending_package_name: r.pending_renewal_package_name ?? null,
      no_upcoming: false,
      square_started_ymd: started,
    });
  }

  // Prepared renewals not in the forecast (no booking beyond the package) stay
  // visible — but one Square already started is NOT shown as Scheduled with an
  // old date; it is flagged for activation instead.
  const seen = new Set(out.map((r) => r.client_id));
  for (const r of eff) {
    if (!r.pending_renewal_start_date || seen.has(r.id)) continue;
    const ups = upcomingFrom(bookingsOf(r), nowIso);
    const upYmds = ups.map(ymd);
    const firstAfter = upYmds.find((y) => y >= (r.pending_renewal_start_date ?? "")) ?? null;
    const used = Number(r.visits_used ?? 0);
    const total = Number(r.package_total_visits ?? 0);
    out.push({
      client_id: r.id,
      visits_used: used,
      package_total_visits: total,
      remaining: Math.max(0, total - used),
      upcoming_count: ups.length,
      appointment_ymds: upYmds,
      first_uncovered_index: Math.max(0, firstAfter ? upYmds.indexOf(firstAfter) : 0),
      first_uncovered_ymd: firstAfter ?? r.pending_renewal_start_date ?? "",
      visit_source: "hub_fallback",
      hub_visits_used: r.visits_used ?? null,
      week_bucket: firstAfter ? bucket(firstAfter) : "later",
      ...pricing(r),
      pre_renewed: true,
      pending_start_ymd: r.pending_renewal_start_date,
      pending_total_visits: r.pending_renewal_total_visits ?? null,
      pending_package_name: r.pending_renewal_package_name ?? null,
      no_upcoming: ups.length === 0,
      square_started_ymd: squareStartedYmd(r),
    });
  }
  out.sort((a, b) => a.first_uncovered_ymd.localeCompare(b.first_uncovered_ymd));
  return out;
}
