import { describe, expect, it } from "vitest";
import { effectiveRemaining, followUpEligible, groupFollowUps, type FollowUpClient } from "./schedule-followup";
import { collectionWeekStart } from "./work-week";

const vt = (mode: "square" | "square_review" | "held" | "hub_fallback", used: number, total = 8) => ({
  mode, used, total, lastVisitDate: null, nextNote: null, nextDate: null, manualCheckInNeeded: false, reason: "",
});
const c = (id: string, over: Partial<FollowUpClient> = {}): FollowUpClient => ({
  id, status: "active", package_total_visits: 8, visits_used: 0, ...over,
});
// Maddox: Hub 0/8, Square 6/8 (clean), last live visit Thu Oct 22, nothing after.
const maddox = c("maddox", { visit: vt("square", 6) });
const maddoxAppts = [
  { client_id: "maddox", day: "2026-10-08" },
  { client_id: "maddox", day: "2026-10-22" },
];

describe("schedule follow-up", () => {
  it("Fri 23:59 vs Sat 00:00 Chicago roll the week", () => {
    expect(collectionWeekStart(new Date("2026-10-24T04:59:59Z"))).toBe("2026-10-19");
    expect(collectionWeekStart(new Date("2026-10-24T05:00:00Z"))).toBe("2026-10-26");
  });

  it("Friday: Maddox has a this-week visit, so she's left to This Week But Not Next", () => {
    const g = groupFollowUps([maddox], maddoxAppts, "2026-10-23");
    expect(g.last_week_nothing_booked).toEqual([]);
    expect(g.not_scheduled_after).toEqual(["maddox"]);
  });

  it("Saturday and Monday: Maddox shows as last visit last week, nothing booked", () => {
    for (const d of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
      const g = groupFollowUps([maddox], maddoxAppts, d);
      expect(g.last_week_nothing_booked).toEqual(["maddox"]);
      expect(g.not_scheduled_after).toEqual([]);
    }
  });

  it("the following week she moves to Not Scheduled After (still visible)", () => {
    const g = groupFollowUps([maddox], maddoxAppts, "2026-11-02");
    expect(g.not_scheduled_after).toEqual(["maddox"]);
  });

  it("a future booking removes her from both groups", () => {
    const g = groupFollowUps([maddox], [...maddoxAppts, { client_id: "maddox", day: "2026-10-29" }], "2026-10-24");
    expect(g).toEqual({ last_week_nothing_booked: [], not_scheduled_after: [] });
  });

  it("groups are disjoint across many clients", () => {
    const list = Array.from({ length: 22 }, (_, i) => c(`c${i}`));
    const appts = list.map((x, i) => ({ client_id: x.id, day: i % 2 ? "2026-10-20" : "2026-10-01" }));
    const g = groupFollowUps(list, appts, "2026-10-24");
    expect(g.last_week_nothing_booked.length).toBe(11);
    expect(g.not_scheduled_after.length).toBe(11);
    expect(new Set([...g.last_week_nothing_booked, ...g.not_scheduled_after]).size).toBe(22);
  });

  it("clean Square count wins over a stale Hub zero with no Hub comparison", () => {
    expect(effectiveRemaining(maddox)).toEqual({ left: 2, check: null });
  });

  it("stale Hub 'used up' doesn't hide a client Square shows has visits left", () => {
    const x = c("x", { visits_used: 8, visit: vt("square", 5) });
    expect(effectiveRemaining(x).left).toBe(3);
    expect(followUpEligible(x)).toBe(true);
  });

  it("flagged Square notes never invent a count; the client stays visible for review", () => {
    const x = c("x", { visits_used: 8, visit: vt("square_review", 4) });
    const r = effectiveRemaining(x);
    expect(r.left).toBe(4); expect(r.check).toMatch(/need review/);
    expect(followUpEligible(x)).toBe(true);
  });

  it("truly used-up, archived, inactive and no-package clients are excluded", () => {
    expect(followUpEligible(c("a", { visits_used: 8, visit: vt("square", 8) }))).toBe(false);
    expect(followUpEligible(c("b", { visits_used: 8 }))).toBe(false);
    expect(followUpEligible(c("d", { status: "archived" }))).toBe(false);
    expect(followUpEligible(c("e", { status: "inactive" }))).toBe(false);
    expect(followUpEligible(c("f", { package_total_visits: 0 }))).toBe(false);
  });

  it("used-up package with a prepared next package stays eligible", () => {
    expect(followUpEligible(c("g", { visits_used: 8, pending_renewal_start_date: "2026-10-27" }))).toBe(true);
  });
});
