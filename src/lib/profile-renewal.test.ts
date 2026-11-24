import { describe, it, expect } from "vitest";
import { selectProfileRenewal } from "./upcoming-first-visit";
import { nextPackagePrefill } from "./profile-renewal";

const now = "2026-11-24T12:00:00Z";
const base = { id: "c1", square_customer_id: "sq1", package_price: 345 };
const b1 = { id: "b1", start_at: "2026-12-04T15:00:00Z", status: "ACCEPTED", seller_note: "1 of 8" };

describe("selectProfileRenewal", () => {
  it("booked 1/x without prepared renewal needs review", () => {
    const r = selectProfileRenewal(base, [b1], now);
    expect(r.kind).toBe("upcoming");
    if (r.kind === "upcoming") { expect(r.item.status).toBe("needs_review"); expect(r.item.total_visits).toBe(8); }
  });
  it("matching prepared renewal is approved", () => {
    const r = selectProfileRenewal({ ...base, pending_renewal_start_date: "2026-12-04", pending_renewal_total_visits: 8, pending_renewal_price: 345 }, [b1], now);
    expect(r.kind === "upcoming" && r.item.status).toBe("approved");
  });
  it("prepared renewal without a booked 1/x is still shown", () => {
    const r = selectProfileRenewal({ ...base, pending_renewal_start_date: "2026-12-10", pending_renewal_total_visits: 4, pending_renewal_price: 200 }, [], now);
    expect(r).toEqual({ kind: "prepared", prepared: { startYmd: "2026-12-10", totalVisits: 4, price: 200, paid: 0 } });
  });
  it("cancelled 1/x and nothing prepared shows none", () => {
    expect(selectProfileRenewal(base, [{ ...b1, status: "CANCELLED_BY_SELLER" }], now).kind).toBe("none");
  });
});

describe("nextPackagePrefill start date", () => {
  const cur = { totalVisits: 8, price: 345, packageName: "8-Visit Package" };
  it("prepared renewal with a booked 1/x starts on the 1/x date, not the stored date", () => {
    const r = selectProfileRenewal({ ...base, pending_renewal_start_date: "2026-12-01", pending_renewal_total_visits: 8, pending_renewal_price: 345 }, [b1], now);
    const p = nextPackagePrefill(r, cur);
    expect(p?.startYmd).toBe("2026-12-04");
    expect(p?.fromBooking).toBe(true);
    expect(p?.hasPrepared).toBe(true);
  });
  it("prepared renewal without a booked 1/x keeps its stored start date", () => {
    const r = selectProfileRenewal({ ...base, pending_renewal_start_date: "2026-12-10", pending_renewal_total_visits: 4, pending_renewal_price: 200 }, [], now);
    const p = nextPackagePrefill(r, cur);
    expect(p?.startYmd).toBe("2026-12-10");
    expect(p?.fromBooking).toBe(false);
  });
  it("booked 1/x with no prepared renewal starts on the 1/x date", () => {
    const p = nextPackagePrefill(selectProfileRenewal(base, [b1], now), cur);
    expect(p?.startYmd).toBe("2026-12-04");
    expect(p?.fromBooking).toBe(true);
  });
});
