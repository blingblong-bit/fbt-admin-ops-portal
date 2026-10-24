import { describe, expect, it } from "vitest";
import { applyOverrides, blocksAutoActivation, type PackageOverride } from "./package-override";

// Leann Uselton, owner-confirmed 10/24/2026: stale raw Hub row (9/18 start, 2/8, $750 on the
// prepared renewal) corrected via admin overrides, never by rewriting raw fields or payments.
const raw = {
  package_total_visits: 8, visits_used: 2, package_price: 375, amount_paid: 375, package_start_date: "2026-09-18",
  previous_package_owed: 0, pending_renewal_start_date: "2026-10-08", pending_renewal_total_visits: 8,
  pending_renewal_price: 375, pending_renewal_paid: 750, visit_tracking_mode: "auto",
};
const cur: PackageOverride = { slot: "current", total_visits: 8, visits_used: 7, price: 375, recognized_paid: 375, start_date: "2026-10-06", status: "active", baseline_visits_used: 2 };
const next: PackageOverride = { slot: "pending", total_visits: 8, visits_used: 0, price: 375, recognized_paid: 0, start_date: "2026-10-29", status: "prepared" };

describe("Leann Uselton correction", () => {
  it("current cycle is 10/6 with 7 of 8 used and nothing owed on it", () => {
    const e = applyOverrides(raw, [cur, next]);
    expect(e.package_start_date).toBe("2026-10-06");
    expect(e.visits_used).toBe(7);
    expect(Number(e.package_price) - Number(e.amount_paid)).toBe(0);
  });
  it("next package starts 10/29 and owes $375 (historical $750 not reused)", () => {
    const e = applyOverrides(raw, [cur, next]);
    expect(e.pending_renewal_start_date).toBe("2026-10-29");
    expect(Number(e.pending_renewal_price) - Number(e.pending_renewal_paid)).toBe(375);
  });
  it("the 10/27 check-in adds on top of the admin figure, capped at the size", () => {
    expect(applyOverrides({ ...raw, visits_used: 3 }, [cur, next]).visits_used).toBe(8);
    expect(applyOverrides({ ...raw, visits_used: 9 }, [cur, next]).visits_used).toBe(8);
  });
  it("applying twice gives the same result (refresh is harmless)", () => {
    const once = applyOverrides(raw, [cur, next]);
    expect(applyOverrides(raw, [cur, next])).toEqual(once);
  });
  it("automatic activation stays held while admin figures are active", () => {
    expect(blocksAutoActivation([cur, next])).toBe(true);
  });
});
