import { describe, expect, it } from "vitest";
import {
  packagePriceUnknown,
  paymentStatus,
  primaryAction,
  simpleStatus,
  totalOwed,
} from "./clients";

type Row = Parameters<typeof paymentStatus>[0] & {
  package_total_visits: number;
  visits_used: number | null;
};

const base = (over: Partial<Row> = {}): Row => ({
  payment_model: "package",
  package_price: 375,
  amount_paid: 0,
  previous_package_owed: 0,
  package_total_visits: 8,
  visits_used: 1,
  ...over,
});

describe("payment status for package clients", () => {
  it("no package info + $0 paid is NOT Paid", () => {
    const c = base({ package_price: 0, package_total_visits: 0, visits_used: null });
    expect(packagePriceUnknown(c)).toBe(true);
    expect(paymentStatus(c)).toBe("package_info_needed");
    expect(simpleStatus(c, true)).toBe("Package Info Needed");
    expect(primaryAction(c, true)).toBe("setup_package");
  });

  it("no package info + positive payment is NOT Paid and needs setup", () => {
    const c = base({ package_price: 0, amount_paid: 200, package_total_visits: 0, visits_used: null });
    expect(paymentStatus(c)).toBe("package_info_needed");
    expect(simpleStatus(c, true)).toBe("Package Info Needed");
  });

  it("price missing but 8 visits configured + $0 paid is Package Info Needed", () => {
    const c = base({ package_price: 0, package_total_visits: 8, visits_used: 0 });
    expect(paymentStatus(c)).toBe("package_info_needed");
  });

  it("price missing with visits and name configured + positive payment is Package Info Needed", () => {
    const c = base({ package_price: 0, amount_paid: 150, package_total_visits: 8, visits_used: 2 });
    expect(paymentStatus(c)).toBe("package_info_needed");
    expect(simpleStatus(c, true)).toBe("Package Info Needed");
  });

  it("valid $375 package fully paid is Paid", () => {
    const c = base({ amount_paid: 375 });
    expect(paymentStatus(c)).toBe("paid");
    expect(totalOwed(c)).toBe(0);
  });

  it("valid $375 package with nothing paid owes $375", () => {
    const c = base();
    expect(paymentStatus(c)).toBe("owes");
    expect(totalOwed(c)).toBe(375);
    expect(simpleStatus(c, true)).toBe("Payment Due");
  });

  it("$375 package with $690 paid and no prepared renewal is Payment Review", () => {
    const c = base({ amount_paid: 690 });
    expect(paymentStatus(c)).toBe("payment_review");
  });

  it("overpayment explained by a prepared renewal is not Payment Review", () => {
    const c = base({ amount_paid: 690, pending_renewal_start_date: "2026-10-01" });
    expect(paymentStatus(c)).toBe("paid");
  });

  it("staff dismissal of 'no package needed' restores normal classification", () => {
    const c = base({ package_price: 0, package_total_visits: 0, visits_used: null });
    expect(paymentStatus(c, true)).toBe("paid");
    expect(simpleStatus(c, true, true)).not.toBe("Package Info Needed");
  });

  it("pay-per-visit client with no outstanding charge keeps a valid zero balance", () => {
    const c = base({ payment_model: "pay_per_visit", package_price: 0, package_total_visits: 0, visits_used: null });
    expect(packagePriceUnknown(c)).toBe(false);
    expect(paymentStatus(c)).toBe("paid");
  });
});
