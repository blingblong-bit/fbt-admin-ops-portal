import { describe, it, expect } from "vitest";
import { routePayment, computeRenewalTransition } from "./payment-routing";

const base = {
  previousPackageOwed: 0,
  amountPaid: 0,
  packagePrice: 375,
  pendingRenewalPaid: 0,
  hasPreparedRenewal: false,
};

describe("routePayment", () => {
  it("pays older package debt before the current package", () => {
    const r = routePayment({ ...base, previousPackageOwed: 100, amountPaid: 0 }, 250);
    expect(r.toPreviousPackage).toBe(100);
    expect(r.toCurrentPackage).toBe(150);
    expect(r.toPendingPackage).toBe(0);
    expect(r.next).toEqual({ previousPackageOwed: 0, amountPaid: 150, pendingRenewalPaid: 0 });
  });

  it("holds money paid ahead against an already-prepared renewal", () => {
    const r = routePayment(
      { ...base, amountPaid: 375, packagePrice: 375, hasPreparedRenewal: true },
      50,
    );
    expect(r.toCurrentPackage).toBe(0);
    expect(r.toPendingPackage).toBe(50);
    expect(r.next.pendingRenewalPaid).toBe(50);
    expect(r.next.amountPaid).toBe(375);
  });

  it("splits between the open current balance and the prepared renewal", () => {
    const r = routePayment(
      { ...base, amountPaid: 300, packagePrice: 375, hasPreparedRenewal: true },
      200,
    );
    expect(r.toCurrentPackage).toBe(75);
    expect(r.toPendingPackage).toBe(125);
  });

  it("leaves unexplained excess on the current package when no renewal is prepared", () => {
    const r = routePayment({ ...base, amountPaid: 345, packagePrice: 345 }, 345);
    expect(r.toPendingPackage).toBe(0);
    expect(r.next.amountPaid).toBe(690);
  });

  it("never creates a credit for a client with no package set up", () => {
    const r = routePayment({ ...base, packagePrice: 0 }, 375);
    expect(r.toPendingPackage).toBe(0);
    expect(r.next.amountPaid).toBe(375);
  });
});

describe("computeRenewalTransition", () => {
  it("applies prepaid money to the new package and carries unpaid debt forward", () => {
    const t = computeRenewalTransition({
      previousPackageOwed: 0,
      amountPaid: 0,
      packagePrice: 0,
      pendingRenewalPaid: 50,
    });
    expect(t.amountPaid).toBe(50);
    expect(t.prepaidApplied).toBe(50);
    expect(t.previousPackageOwed).toBe(0);
  });

  it("carries the unpaid remainder forward as previous-package debt", () => {
    const t = computeRenewalTransition({
      previousPackageOwed: 25,
      amountPaid: 300,
      packagePrice: 375,
      pendingRenewalPaid: 0,
    });
    expect(t.unpaidCarriedForward).toBe(75);
    expect(t.previousPackageOwed).toBe(100);
    expect(t.amountPaid).toBe(0);
  });

  it("adds money collected at renewal time on top of prepaid money", () => {
    const t = computeRenewalTransition(
      { previousPackageOwed: 0, amountPaid: 375, packagePrice: 375, pendingRenewalPaid: 100 },
      50,
    );
    expect(t.amountPaid).toBe(150);
    expect(t.previousPackageOwed).toBe(0);
  });
});
