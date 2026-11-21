import { describe, expect, it } from "vitest";
import { drivingCounts, forecastRenewal, resolveEffectiveVisitState } from "./effective-visit-state";
import { computeMasterDues, liveNumbered, renewalTimingFor } from "./master-dues";
import { applyOverrides, type PackageOverride } from "./package-override";
import { upcomingFrom, type ForecastBooking } from "./renewal-forecast";

const client = {
  id: "anonymous", first_name: "Test", last_name: "Client", status: "active",
  package_start_date: "2026-08-14", visits_used: 3, package_total_visits: 8,
  package_price: 345, amount_paid: 345, previous_package_owed: 0,
  pending_renewal_start_date: "2026-11-06", pending_renewal_price: 345,
  pending_renewal_paid: 0, visit_tracking_mode: "auto",
};
const booking = (id: string, day: string, n: number, status = "ACCEPTED"): ForecastBooking & { start_at: string } => ({
  id, start_at: `${day}T15:00:00Z`, seller_note: `${n} of 8`, status,
});
const current = ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-23", "2026-11-06"]
  .map((day, index) => booking(`current-${index}`, day, index + 1));
const bookings = [booking("old-finish", "2026-08-14", 8), ...current];
const during = "2026-09-24T18:00:00Z";

function evaluate(bs = bookings, now = during, c = client, overrides: PackageOverride[] = []) {
  const effective = applyOverrides(c, overrides);
  const state = resolveEffectiveVisitState(effective, bs, now);
  const counts = drivingCounts(state);
  const forecast = forecastRenewal({
    upcomingStarts: upcomingFrom(bs, now), visitsUsed: counts.used,
    totalVisits: counts.total, nextPackageStart: counts.nextPackageStart,
  });
  const timing = renewalTimingFor(effective, {
    suppressed: state.suppressed, ...counts, firstUncoveredStart: forecast.firstUncoveredStart,
  }, now, { live: liveNumbered(bs), preparedAtIso: "2026-09-23T18:00:00Z" });
  const dues = computeMasterDues([effective], {
    todayYmd: now.slice(0, 10), nextAppointmentYmd: new Map(),
    renewalTiming: new Map([[c.id, timing]]),
  });
  return { state, timing, dues, effective };
}

describe("current package opened after its recorded Hub start", () => {
  it("a later opener without boundary evidence is held for review, not treated as debt", () => {
    expect(renewalTimingFor(client, {
      suppressed: false, used: 4, total: 8, currentPackageStart: "2026-08-28T15:00:00Z",
      nextPackageStart: null, firstUncoveredStart: null,
    }, during)).toMatchObject({ kind: "unknown", ymd: null });
  });

  it("completion on the Hub renewal date belongs to the previous cycle, not the new package", () => {
    const result = evaluate();
    expect(result.state.currentPackageStart).toBe("2026-08-28T15:00:00Z");
    expect(result.timing).toMatchObject({ kind: "no_start", ymd: null });
  });

  it("a paid $345 current package with four remaining visits does not make its unpaid renewal Due Now", () => {
    const result = evaluate();
    expect(result.state.remainingVisits).toBe(4);
    expect(result.dues.rows[0]?.current.amount).toBe(0);
    expect(result.dues.rows[0]?.renewal).toEqual({ amount: 345, status: "prepared", expected_ymd: null });
    expect(result.dues.totals.renewalByStatus.due_now.dollars).toBe(0);
  });

  it("a completion before the Hub start also cannot open the prepared renewal", () => {
    expect(evaluate([booking("older-finish", "2026-08-12", 8), ...current]).timing.kind).toBe("no_start");
  });

  it.each(["CANCELLED_BY_SELLER", "CANCELLED_BY_CUSTOMER", "NO_SHOW", "DECLINED"])("a future %s booking cannot advance counts or renewal timing", (status) => {
    const result = evaluate([...bookings, booking("cancelled-opener", "2026-11-20", 1, status)]);
    expect([result.state.visitsUsed, result.state.remainingVisits]).toEqual([4, 4]);
    expect(result.state.nextPackageStart).toBeNull();
    expect(result.timing.kind).toBe("no_start");
    expect(result.dues.totals.renewalByStatus.due_now.dollars).toBe(0);
  });

  it("completion alone is not a renewal start; a cancelled opener remains excluded after its date", () => {
    const result = evaluate([...bookings, booking("cancelled-opener", "2026-11-20", 1, "CANCELLED_BY_SELLER")], "2026-11-21T18:00:00Z");
    expect(result.state.currentPackageStart).toBe("2026-08-28T15:00:00Z");
    expect(result.timing.kind).toBe("no_start");
  });

  it("the next real 1/8 is Upcoming after current completion, and Due Now only once it starts", () => {
    const bs = [...bookings, booking("next-opener", "2026-12-04", 1)];
    const before = evaluate(bs, "2026-11-21T18:00:00Z");
    expect(before.state.visitsUsed).toBe(8);
    expect(before.dues.rows[0]?.renewal).toEqual({ amount: 345, status: "upcoming", expected_ymd: "2026-12-04" });
    const after = evaluate(bs, "2026-12-04T16:00:00Z");
    expect(after.dues.rows[0]?.renewal).toEqual({ amount: 345, status: "due_now", expected_ymd: "2026-12-04" });
  });

  it("manual activation aligned to the new opener keeps that cycle current", () => {
    const result = evaluate([...bookings, booking("next-opener", "2026-12-04", 1)], "2026-12-04T16:00:00Z", { ...client, package_start_date: "2026-12-04" });
    expect(result.timing.kind).toBe("no_start");
    expect(result.dues.rows[0]?.renewal.status).toBe("prepared");
  });

  it("explicit early payment stays associated with the prepared renewal, never current-package carryforward", () => {
    const result = evaluate(bookings, during, { ...client, pending_renewal_paid: 100, previous_package_owed: 20 });
    expect(result.dues.rows[0]?.renewal).toMatchObject({ amount: 245, status: "prepared" });
    expect(result.dues.rows[0]?.previous.amount).toBe(20);
    expect(result.dues.rows[0]?.total).toBe(265);
    expect(result.effective.amount_paid).toBe(345);
  });

  it("active audited date/financial overrides remain effective and manual count overrides remain authoritative", () => {
    const override: PackageOverride = { slot: "current", total_visits: 8, visits_used: null, price: 345, recognized_paid: 345, start_date: "2026-08-28", status: "active" };
    const result = evaluate(bookings, during, { ...client, package_price: 0, amount_paid: 0 }, [override]);
    expect(result.effective.package_start_date).toBe("2026-08-28");
    expect(result.state.source).toBe("square");
    expect(result.dues.rows[0]?.current.amount).toBe(0);
    expect(result.timing.kind).toBe("no_start");
    const manual = evaluate(bookings, during, client, [{ ...override, visits_used: 2 }]);
    expect([manual.state.source, manual.state.visitsUsed]).toEqual(["hub_fallback", 2]);
  });

  it("legacy excess remains Payment Review without reducing the next package's $345", () => {
    const result = evaluate(bookings, during, { ...client, amount_paid: 445 });
    expect(result.dues.exceptions).toEqual([expect.objectContaining({ kind: "payment_review" })]);
    expect(result.dues.rows[0]?.renewal.amount).toBe(345);
    expect(result.effective.amount_paid).toBe(445);
    expect(result.effective.pending_renewal_paid).toBe(0);
  });
});