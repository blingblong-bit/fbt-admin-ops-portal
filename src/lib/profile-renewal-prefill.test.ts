import { describe, it, expect } from "vitest";
import { nextPackagePrefill, nextPackageLine, startsNow } from "./profile-renewal";
import { selectProfileRenewal } from "./upcoming-first-visit";

const now = "2026-11-24T12:00:00Z";
const base = { id: "c1", square_customer_id: "sq1", package_price: 345 };
const b1 = { id: "b1", start_at: "2026-12-04T15:00:00Z", status: "ACCEPTED", seller_note: "1 of 8" };
const cur = { totalVisits: 4, price: 345, packageName: null };

describe("profile next package", () => {
  it("prepared renewal keeps its details but starts on the booked 1/x date", () => {
    const r = selectProfileRenewal({ ...base, pending_renewal_start_date: "2026-12-10", pending_renewal_total_visits: 4, pending_renewal_price: 200, pending_renewal_paid: 50 }, [b1], now);
    const p = nextPackagePrefill(r, cur)!;
    expect([p.visits, p.price, p.startYmd, p.paid, p.hasPrepared, p.fromBooking]).toEqual([4, 200, "2026-12-04", 50, true, true]);
    expect(nextPackageLine(p)).toContain("· paid $50");
  });
  it("booked 1/x: date from booking, N from note, price = current package", () => {
    const p = nextPackagePrefill(selectProfileRenewal(base, [b1], now), cur)!;
    expect([p.visits, p.price, p.startYmd, p.hasPrepared]).toEqual([8, 345, "2026-12-04", false]);
    expect(nextPackageLine(p)).toBe("Next package: 8 visits · $345 · starts Fri, Dec 4 (1/8 booked)");
  });
  it("falls back to current package with blank date", () => {
    const p = nextPackagePrefill(selectProfileRenewal(base, [], now), cur)!;
    expect([p.visits, p.price, p.startYmd]).toEqual([4, 345, null]);
  });
  it("nothing to pre-fill shows not set", () => {
    const p = nextPackagePrefill({ kind: "none" }, { totalVisits: null, price: 0, packageName: null });
    expect(nextPackageLine(p)).toBe("Next package: not set");
  });
  it("today or earlier renews now, future prepares", () => {
    expect(startsNow("2026-11-24", "2026-11-24")).toBe(true);
    expect(startsNow("2026-11-20", "2026-11-24")).toBe(true);
    expect(startsNow("2026-11-25", "2026-11-24")).toBe(false);
  });
});
