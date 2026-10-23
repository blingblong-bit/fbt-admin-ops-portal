import { describe, expect, it } from "vitest";
import { paymentSource, planCorrection, type PackageSnapshot } from "./package-correction";

const cur: PackageSnapshot = {
  package_name: null, package_total_visits: 8, visits_used: 2, package_price: 375, amount_paid: 375,
  package_start_date: null, pending_renewal_start_date: "2026-10-19", pending_renewal_total_visits: 8,
  pending_renewal_price: 375, pending_renewal_package_name: null,
};
const form = {
  package_total_visits: 8, visits_used: 2, package_price: 375, amount_paid: 375, package_start_date: null,
  renewal_start_date: "2026-10-19", renewal_total_visits: 8, renewal_price: 375,
};

describe("planCorrection", () => {
  it("no edits means no changes", () => {
    const p = planCorrection(cur, form);
    expect(p.changes).toEqual([]);
    expect(p.renewal).toBeNull();
    expect(p.errors).toEqual([]);
  });
  it("blocks raising paid so Square payments can't be fabricated", () => {
    expect(planCorrection(cur, { ...form, amount_paid: 400 }).errors.length).toBe(1);
  });
  it("allows lowering paid with a patch", () => {
    expect(planCorrection(cur, { ...form, amount_paid: 175 }).packagePatch).toEqual({ amount_paid: 175 });
  });
  it("blocks visits used above package size", () => {
    expect(planCorrection(cur, { ...form, visits_used: 9 }).errors.length).toBe(1);
  });
  it("patches visits and start date", () => {
    const p = planCorrection(cur, { ...form, visits_used: 8, package_start_date: "2026-09-14" });
    expect(p.packagePatch).toEqual({ visits_used: 8, package_start_date: "2026-09-14" });
  });
  it("renewal edit goes to the renewal step only", () => {
    const p = planCorrection(cur, { ...form, renewal_total_visits: 4 });
    expect(p.packagePatch).toEqual({});
    expect(p.renewal).toEqual({ startYmd: "2026-10-19", totalVisits: 4, price: 375, packageName: null });
  });
  it("can't create a renewal that doesn't exist", () => {
    const none = { ...cur, pending_renewal_start_date: null, pending_renewal_total_visits: null, pending_renewal_price: null };
    expect(planCorrection(none, { ...form }).errors.length).toBe(1);
  });
});

describe("paymentSource", () => {
  it("separates hand-entered from Square", () => {
    expect(paymentSource({ source: "square", square_payment_id: "abc" })).toBe("square");
    expect(paymentSource({ source: "manual", square_payment_id: "manual:x" })).toBe("manual");
  });
});
