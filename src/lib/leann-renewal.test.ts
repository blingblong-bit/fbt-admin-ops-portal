// End-to-end renewal lifecycle for Leann Uselton through the production pure
// path: applyOverrides -> Square effective state -> buildRenewalForecastRows ->
// groupRenewals, plus Collections via renewalTimingFor/computeMasterDues and
// the sweep decision. Fixture Square bookings and a moving clock; no DB.
import { describe, expect, it } from "vitest";
import { applyOverrides, type PackageOverride } from "./package-override";
import { buildRenewalForecastRows, upcomingFrom, type ForecastBooking } from "./renewal-forecast";
import { groupRenewals } from "./renewals-view";
import { decideOverridePendingStart } from "./square-activation";
import { buildSequence, detectNoteIssues } from "./square-visit-audit";
import { currentPositionUnreadable, drivingCounts, forecastRenewal, resolveEffectiveVisitState } from "./effective-visit-state";
import { computeMasterDues, renewalTimingFor } from "./master-dues";
import { chicagoYmd, workWeekStartFromYmd, addDaysYmd } from "./work-week";

const ID = "leann";
// Stale raw Hub row: 9/18 start, 2/8, prepared 10/8 with a historical $750 on it.
const raw = {
  id: ID, first_name: "Leann", last_name: "Uselton", square_customer_id: "SQ", visit_tracking_mode: "auto",
  package_total_visits: 8, visits_used: 2, package_price: 375, amount_paid: 375, package_start_date: "2026-09-18",
  previous_package_owed: 0, next_package_price: null, pending_renewal_start_date: "2026-10-08", pending_renewal_total_visits: 8,
  pending_renewal_price: 375, pending_renewal_paid: 750, pending_renewal_package_name: "8 visits",
};
type Ovr = PackageOverride & { client_id: string };
// Current: financial/date-only (visits_used null) — Square supplies visit numbers.
const cur: Ovr = { client_id: ID, slot: "current", total_visits: 8, visits_used: null, price: 375, recognized_paid: 375, start_date: "2026-10-06", status: "active" };
const nextPrepared: Ovr = { client_id: ID, slot: "pending", total_visits: 8, visits_used: 0, price: 375, recognized_paid: 0, start_date: "2026-10-29", status: "prepared" };

const bk = (id: string, iso: string, note: string | null, status = "ACCEPTED"): ForecastBooking => ({ id, start_at: iso, status, seller_note: note });
const base: ForecastBooking[] = [
  bk("o8", "2026-10-01T15:00:00Z", "8/8"),
  bk("a1", "2026-10-06T15:00:00Z", "1/8"), bk("a2", "2026-10-08T15:00:00Z", "2/8"), bk("a3", "2026-10-13T15:00:00Z", "3/8"),
  bk("a4", "2026-10-15T15:00:00Z", "4/8"), bk("a5", "2026-10-20T15:00:00Z", "5/8"), bk("a6", "2026-10-21T15:00:00Z", "6/8"),
  bk("a7", "2026-10-22T15:00:00Z", "7/8"), bk("a8", "2026-10-27T15:00:00Z", "8/8"),
  bk("b1", "2026-10-29T21:30:00Z", "1/8"), bk("b2", "2026-10-30T15:00:00Z", "2/8"),
];

function forecast(nowIso: string, bookings: ForecastBooking[], overrides: Ovr[], client = raw) {
  const ws = workWeekStartFromYmd(chicagoYmd(new Date(nowIso)));
  return buildRenewalForecastRows({
    clients: [client as never], overrides, bookingsByCustomer: new Map([["SQ", bookings]]),
    nowIso, weekStartYmd: ws, nextWeekStartYmd: addDaysYmd(ws, 7),
  });
}
function collections(nowIso: string, bookings: ForecastBooking[], overrides: Ovr[]) {
  const e = applyOverrides(raw, overrides);
  const live = bookings.map((b) => ({ ...b, start_at: b.start_at! }));
  const st = resolveEffectiveVisitState(e, live, nowIso);
  const d = drivingCounts(st);
  const f = forecastRenewal({ upcomingStarts: upcomingFrom(bookings, nowIso), visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
  const t = renewalTimingFor(e, { suppressed: st.suppressed, ...d, firstUncoveredStart: f.firstUncoveredStart }, nowIso);
  const row = computeMasterDues([e as never], { todayYmd: chicagoYmd(new Date(nowIso)), nextAppointmentYmd: new Map(), renewalTiming: new Map([[ID, t]]) }).rows[0];
  return { row, state: st, eff: e };
}
const sweep = (nowIso: string, bookings: ForecastBooking[], overrides: Ovr[], client: typeof raw = raw) => {
  const seq = buildSequence(bookings.map((b) => ({ ...b, start_at: b.start_at! })) as never, nowIso);
  return decideOverridePendingStart({ client, overrides, seq, currentUnreadable: currentPositionUnreadable(seq, detectNoteIssues(seq)) });
};
const moneyOf = (c: typeof raw) => ({ amount_paid: c.amount_paid, pending_paid: c.pending_renewal_paid, prev_owed: c.previous_package_owed });
/** Mirrors start_pending_override_from_square (exercised for real in the SQL rollback test). */
function promote(overrides: Ovr[], d: ReturnType<typeof sweep>, client: typeof raw = raw): Ovr[] {
  if (d.kind !== "activate" || !d.figures) throw new Error("not eligible: " + d.reason);
  const f = d.figures;
  const keep = overrides.filter((o) => o.slot !== "current" && o.slot !== "pending" && o.slot !== "previous");
  return [...keep,
    { client_id: ID, slot: "previous", total_visits: null, visits_used: null, price: f.prev_owed, recognized_paid: 0, start_date: null, status: "completed", raw_baseline: moneyOf(client) },
    { client_id: ID, slot: "current", total_visits: f.total, visits_used: null, price: f.price, recognized_paid: f.recognized_paid, start_date: d.startYmd, status: "active", square_booking_id: d.bookingId, raw_baseline: moneyOf(client) },
  ];
}
const TODAY = "2026-10-24T18:00:00Z"; // Sat 1pm Chicago
const AFTER_START = "2026-10-29T23:00:00Z"; // Thu 6pm Chicago, after the 4:30pm 1/8

describe("Leann lifecycle — today (7/8 done, 8/8 Oct 27 and 1/8 Oct 29 upcoming)", () => {
  it("visit position comes from Square, not a pegged count", () => {
    const { state, eff } = collections(TODAY, base, [cur, nextPrepared]);
    expect(eff.visit_tracking_mode).toBe("auto");
    expect(state.source).toBe("square");
    expect([state.visitsUsed, state.totalVisits]).toEqual([7, 8]);
    expect(eff.package_start_date).toBe("2026-10-06");
  });
  it("Renewals: Scheduled for Oct 29 at $375 (historical $750 not reused)", () => {
    const rows = forecast(TODAY, base, [cur, nextPrepared]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pre_renewed: true, pending_start_ymd: "2026-10-29", first_uncovered_ymd: "2026-10-29", visit_source: "square", visits_used: 7, next_package_price: 375, square_started_ymd: null, week_bucket: "this" });
    expect(groupRenewals(rows).scheduled.map((r) => r.client_id)).toEqual([ID]);
  });
  it("Collections: $375 next package expected Oct 29, nothing owed on the current one", () => {
    const { row } = collections(TODAY, base, [cur, nextPrepared]);
    expect(row.renewal).toMatchObject({ amount: 375, expected_ymd: "2026-10-29" });
    expect(row.current.amount).toBe(0);
  });
  it("an upcoming (future) 1/8 never starts the package", () => {
    expect(sweep(TODAY, base, [cur, nextPrepared]).kind).toBe("not_ready");
  });
});

describe("Leann lifecycle — Oct 29 1/8 verified in the past", () => {
  it("before the sweep: never shown as Scheduled with an old date; flagged awaiting activation", () => {
    const rows = forecast(AFTER_START, base, [cur, nextPrepared]);
    const g = groupRenewals(rows);
    expect(g.scheduled).toHaveLength(0);
    expect(g.attention.map((r) => r.square_started_ymd)).toEqual(["2026-10-29"]);
    // Collections still holds the $375 (renewal treated as started).
    expect(collections(AFTER_START, base, [cur, nextPrepared]).row.renewal.amount).toBe(375);
  });
  it("sweep decides to start it from the Oct 29 booking", () => {
    expect(sweep(AFTER_START, base, [cur, nextPrepared])).toMatchObject({ kind: "activate", bookingId: "b1", startYmd: "2026-10-29", total: 8 });
  });
  const after = promote([cur, nextPrepared], sweep(AFTER_START, base, [cur, nextPrepared]));
  it("after the sweep: completely absent from Renewals, still absent on refresh", () => {
    expect(forecast(AFTER_START, base, after)).toEqual([]);
    expect(forecast(AFTER_START, base, after)).toEqual([]);
    expect(forecast("2026-10-31T05:00:00Z", base, after)).toEqual([]); // Sat 00:00 Chicago rollover
  });
  it("Square keeps tracking the new package (2 visits after Oct 30)", () => {
    const { state, eff } = collections("2026-10-30T20:00:00Z", base, after);
    expect(eff.visit_tracking_mode).toBe("auto");
    expect([state.source, state.visitsUsed, state.totalVisits]).toEqual(["square", 2, 8]);
    expect(eff.package_start_date).toBe("2026-10-29");
  });
  it("Collections keeps the unpaid $375 exactly once; no $750 carried", () => {
    const { row, eff } = collections(AFTER_START, base, after);
    expect(row.current.amount).toBe(375);
    expect(row.renewal.amount).toBe(0);
    expect(Number(eff.previous_package_owed)).toBe(0);
    expect(row.total).toBe(375);
  });
  it("re-running the sweep is a no-op (stale Oct 8 raw prepared row is consumed, not reused)", () => {
    expect(sweep(AFTER_START, base, after).kind).toBe("skip");
    expect(applyOverrides(raw, after).pending_renewal_start_date).toBeNull();
  });
  it("bookings beyond the new package bring back only the NEW renewal with the right date", () => {
    const more = [...base,
      bk("b3", "2026-11-02T15:00:00Z", null), bk("b4", "2026-11-03T15:00:00Z", null), bk("b5", "2026-11-04T15:00:00Z", null),
      bk("b6", "2026-11-05T15:00:00Z", null), bk("b7", "2026-11-06T15:00:00Z", null), bk("b8", "2026-11-09T15:00:00Z", null),
      bk("c1", "2026-11-10T15:00:00Z", null)];
    const rows = forecast("2026-10-30T20:00:00Z", more, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pre_renewed: false, first_uncovered_ymd: "2026-11-10", visits_used: 2, remaining: 6 });
    expect(groupRenewals(rows).needs.map((r) => r.client_id)).toEqual([ID]);
  });
});

describe("Square evidence guards", () => {
  const at = AFTER_START;
  it("1/8 before the prepared date gate does not start it", () => {
    expect(sweep(at, base, [cur, { ...nextPrepared, start_date: "2026-10-30" }]).kind).toBe("not_ready");
  });
  it("cancelled or no-show 1/8 does not start it", () => {
    const c = base.map((b) => (b.id === "b1" ? { ...b, status: "CANCELLED_BY_CUSTOMER" } : b));
    expect(sweep(at, c, [cur, nextPrepared]).kind).not.toBe("activate");
    const n = base.map((b) => (b.id === "b1" ? { ...b, status: "NO_SHOW" } : b));
    expect(sweep(at, n, [cur, nextPrepared]).kind).not.toBe("activate");
  });
  it("two 1/8s / size mismatch are ambiguous", () => {
    expect(sweep(at, [...base, bk("x", "2026-10-29T22:00:00Z", "1/8")], [cur, nextPrepared]).kind).toBe("ambiguous");
    expect(sweep(at, base, [cur, { ...nextPrepared, total_visits: 4 }]).kind).toBe("ambiguous");
  });
  it("failed Square lookup never starts it", () => {
    expect(decideOverridePendingStart({ client: raw, overrides: [cur, nextPrepared], seq: null, currentUnreadable: false }).kind).toBe("not_ready");
  });
  it("a manual current visit-count override stays authoritative: Hub mode, no auto start", () => {
    const manual: Ovr = { ...cur, visits_used: 7 };
    expect(applyOverrides(raw, [manual, nextPrepared]).visit_tracking_mode).toBe("hub");
    expect(sweep(at, base, [manual, nextPrepared]).kind).toBe("skip");
  });
});

describe("Saturday midnight Chicago rollover", () => {
  it("Oct 29 is next week at Fri 23:59 and this week at Sat 00:00", () => {
    expect(forecast("2026-10-24T04:59:00Z", base, [cur, nextPrepared])[0].week_bucket).toBe("next");
    expect(forecast("2026-10-24T05:00:00Z", base, [cur, nextPrepared])[0].week_bucket).toBe("this");
  });
});

describe("Non-override stale prepared renewal", () => {
  it("raw prepared row Square already started is flagged, not Scheduled with the old date", () => {
    const plain = { ...raw, package_start_date: "2026-10-06", visits_used: 8, pending_renewal_start_date: "2026-10-29", pending_renewal_paid: 0 };
    const g = groupRenewals(forecast(AFTER_START, base, [], plain));
    expect(g.scheduled).toHaveLength(0);
    expect(g.attention[0].square_started_ymd).toBe("2026-10-29");
  });
});

describe("Second cycle: staff prepares Nov 10, Square 1/8 on Nov 10", () => {
  const cycle1 = promote([cur, nextPrepared], sweep(AFTER_START, base, [cur, nextPrepared]));
  const later = [...base,
    bk("b3", "2026-11-02T15:00:00Z", "3/8"), bk("b4", "2026-11-03T15:00:00Z", "4/8"), bk("b5", "2026-11-04T15:00:00Z", "5/8"),
    bk("b6", "2026-11-05T15:00:00Z", "6/8"), bk("b7", "2026-11-06T15:00:00Z", "7/8"), bk("b8", "2026-11-09T15:00:00Z", "8/8"),
    bk("c1", "2026-11-10T21:00:00Z", "1/8"), bk("c2", "2026-11-12T15:00:00Z", "2/8")];
  // preRenewNextPackage writes only raw pending fields; raw pending paid still holds the old $750.
  const prepared = { ...raw, pending_renewal_start_date: "2026-11-10", pending_renewal_price: 400, pending_renewal_total_visits: 8 };
  const PRE = "2026-11-07T18:00:00Z", POST = "2026-11-11T18:00:00Z";
  it("the new raw preparation is visible (not shadowed) and Scheduled with $400 due, old $750 not reused", () => {
    const e = applyOverrides(prepared, cycle1);
    expect(e.pending_renewal_start_date).toBe("2026-11-10");
    expect(Number(e.pending_renewal_paid)).toBe(0);
    const rows = forecast(PRE, later, cycle1, prepared);
    expect(groupRenewals(rows).scheduled.map((r) => [r.pending_start_ymd, r.next_package_price, r.square_started_ymd])).toEqual([["2026-11-10", 400, null]]);
  });
  it("unpaid Oct 29 $375 remains owed before the second start", () => {
    const e = applyOverrides(prepared, cycle1);
    expect(Number(e.package_price) - Number(e.amount_paid)).toBe(375);
  });
  it("the earlier correction does not block the next automatic start", () => {
    expect(sweep(PRE, later, cycle1, prepared).kind).toBe("not_ready"); // future 1/8 only
    const d = sweep(POST, later, cycle1, prepared);
    expect(d).toMatchObject({ kind: "activate", bookingId: "c1", startYmd: "2026-11-10" });
    expect(d.figures).toMatchObject({ price: 400, recognized_paid: 0, prev_owed: 375, total: 8 });
  });
  const cycle2 = promote(cycle1, sweep(POST, later, cycle1, prepared), prepared);
  it("after the second start: Renewals clear, $375 is prior debt once, $400 current, no $750", () => {
    expect(forecast(POST, later, cycle2, prepared)).toEqual([]);
    expect(forecast(POST, later, cycle2, prepared)).toEqual([]);
    const e = applyOverrides(prepared, cycle2);
    expect([Number(e.previous_package_owed), Number(e.package_price) - Number(e.amount_paid), e.package_start_date, e.pending_renewal_start_date]).toEqual([375, 400, "2026-11-10", null]);
    expect(e.visit_tracking_mode).toBe("auto");
    expect(sweep(POST, later, cycle2, prepared).kind).toBe("skip");
  });
  it("a Square payment recorded later counts once, prior debt first", () => {
    // apply_square_payment put $500 on the raw row (raw prior owed 0, raw current full → raw prepared paid).
    const paid = { ...prepared, pending_renewal_paid: 750 + 500 };
    const e = applyOverrides(paid, cycle2);
    expect([Number(e.previous_package_owed), Number(e.package_price) - Number(e.amount_paid)]).toEqual([0, 275]);
  });
});
