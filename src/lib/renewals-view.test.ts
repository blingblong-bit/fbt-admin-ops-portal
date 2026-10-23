import { describe, expect, it } from "vitest";
import { groupRenewals } from "./renewals-view";
import type { RenewalForecastRow } from "./schedule.functions";

const row = (p: Partial<RenewalForecastRow>): RenewalForecastRow => ({
  client_id: "c", visits_used: 7, package_total_visits: 8, remaining: 1, upcoming_count: 2,
  appointment_ymds: [], first_uncovered_index: 1, first_uncovered_ymd: "2026-10-28",
  week_bucket: "this", package_price: 375, next_package_price: 375, pre_renewed: false,
  pending_start_ymd: null, pending_total_visits: null, pending_package_name: null,
  no_upcoming: false, visit_source: "square", hub_visits_used: null, ...p,
});

describe("groupRenewals", () => {
  it("needs renewal only when bookings go past the package", () => {
    const g = groupRenewals([row({ client_id: "a" }), row({ client_id: "b", upcoming_count: 1 })]);
    expect(g.needs.map((r) => r.client_id)).toEqual(["a"]);
  });
  it("prepared renewals are Scheduled, not Needs Renewal", () => {
    const g = groupRenewals([row({ pre_renewed: true })]);
    expect([g.scheduled.length, g.needs.length]).toEqual([1, 0]);
  });
  it("activated client (no longer prepared, bookings covered) leaves Scheduled", () => {
    const g = groupRenewals([row({ pre_renewed: false, visits_used: 1, remaining: 7, upcoming_count: 1 })]);
    expect(g.scheduled.length + g.needs.length + g.attention.length).toBe(0);
  });
  it("prepared with nothing booked or review flags go to Needs Attention only", () => {
    const g = groupRenewals([row({ pre_renewed: true, no_upcoming: true }), row({ review_status: "needs_review" })]);
    expect([g.attention.length, g.scheduled.length, g.needs.length]).toEqual([2, 0, 0]);
  });
});
