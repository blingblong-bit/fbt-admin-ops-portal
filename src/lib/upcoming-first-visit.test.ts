import { describe, it, expect } from "vitest";
import { findUpcomingFirstVisits, mondayOf, overpaidAmount, upcomingWeekSummary } from "./upcoming-first-visit";

const NOW = "2026-11-24T15:00:00Z"; // Tue
const c = { id: "c1", first_name: "Ann", last_name: "Lee", square_customer_id: "sq1", package_price: 375 };
const bk = (id: string, start_at: string, note: string, status = "ACCEPTED") => ({ id, start_at, status, seller_note: note });

describe("upcoming 1/x visits", () => {
  it("weeks run Monday to Sunday", () => {
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2026-11-30")).toBe("2026-11-30");
  });
  it("shows a booked 1/8 next week even while old-package visits remain", () => {
    const m = new Map([["sq1", [bk("a", "2026-11-26T15:00:00Z", "7 of 8"), bk("b", "2026-12-02T15:00:00Z", "1 of 8")]]]);
    const r = findUpcomingFirstVisits([c], m, NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ymd: "2026-12-02", week_start: "2026-11-30", total_visits: 8, price: 375, status: "needs_review" });
  });
  it("ignores cancelled, no-show and already-started 1/x bookings", () => {
    const m = new Map([["sq1", [bk("a", "2026-11-30T15:00:00Z", "1 of 8", "CANCELLED_BY_SELLER"), bk("b", "2026-11-20T15:00:00Z", "1 of 8"), bk("c", "2026-12-01T15:00:00Z", "1 of 4", "NO_SHOW")]]]);
    expect(findUpcomingFirstVisits([c], m, NOW)).toEqual([]);
  });
  it("is approved only when the prepared renewal matches that booking's date and size", () => {
    const m = new Map([["sq1", [bk("b", "2026-12-02T15:00:00Z", "1 of 8")]]]);
    const ok = findUpcomingFirstVisits([{ ...c, pending_renewal_start_date: "2026-12-02", pending_renewal_total_visits: 8, pending_renewal_price: 345 }], m, NOW)[0]!;
    expect(ok.status).toBe("approved");
    expect(ok.price).toBe(345);
    const other = findUpcomingFirstVisits([{ ...c, pending_renewal_start_date: "2026-11-06", pending_renewal_total_visits: 8, pending_renewal_price: 345 }], m, NOW)[0]!;
    expect(other.status).toBe("needs_review");
    expect(other.price).toBe(345);
  });
  it("weekly summary sums upcoming prices and counts reviews separately", () => {
    const m = new Map([["sq1", [bk("b", "2026-11-27T15:00:00Z", "1 of 8")]]]);
    const s = upcomingWeekSummary(findUpcomingFirstVisits([c], m, NOW), "2026-11-23");
    expect(s).toMatchObject({ dollars: 375, needReview: 1 });
    expect(upcomingWeekSummary(findUpcomingFirstVisits([c], m, NOW), "2026-11-30").dollars).toBe(0);
  });
  it("overpaid includes stored prepared-renewal money and money above the price", () => {
    expect(overpaidAmount({ package_price: 375, amount_paid: 450, pending_renewal_paid: 100 })).toBe(75);
    expect(overpaidAmount({ package_price: 375, amount_paid: 375, pending_renewal_paid: 0 })).toBe(0);
  });
});
