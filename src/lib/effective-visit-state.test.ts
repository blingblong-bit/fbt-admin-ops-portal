import { describe, expect, it } from "vitest";
import { drivingCounts, forecastRenewal, resolveEffectiveVisitState } from "./effective-visit-state";

const now = "2026-09-24T12:00:00Z";
const b = (id: string, d: string, note: string, status = "ACCEPTED") => ({
  id,
  start_at: `${d}T15:00:00Z`,
  seller_note: note,
  status,
});
const hub = (used: number | null, total = 8) => ({ visits_used: used, package_total_visits: total });

describe("resolveEffectiveVisitState", () => {
  it("coherent Square sequence drives state; future never counts", () => {
    const s = resolveEffectiveVisitState(hub(4), [
      b("1", "2026-09-01", "4/8"),
      b("2", "2026-09-08", "5/8"),
      b("3", "2026-09-15", "6/8"),
      b("4", "2026-09-29", "7/8"),
      b("5", "2026-10-06", "8/8"),
    ], now);
    expect(s.source).toBe("square");
    expect(s.visitsUsed).toBe(6);
    expect(s.remainingVisits).toBe(2);
    expect(s.upcoming.map((u) => u.note)).toEqual(["7/8", "8/8"]);
  });

  it("Hub mismatch does not override Square", () => {
    const s = resolveEffectiveVisitState(hub(2), [b("1", "2026-09-10", "5/8"), b("2", "2026-09-17", "6/8")], now);
    expect(s.source).toBe("square");
    expect(s.visitsUsed).toBe(6);
    expect(drivingCounts(s).used).toBe(6);
  });

  it("clean 8/8 then future 1/8 detects the renewal start", () => {
    const s = resolveEffectiveVisitState(hub(7), [
      b("1", "2026-09-10", "7/8"),
      b("2", "2026-09-17", "8/8"),
      b("3", "2026-09-30", "1/8"),
    ], now);
    expect(s.visitsUsed).toBe(8);
    expect(s.nextVisitNumber).toBe(1);
    expect(s.nextPackageStart).toBe("2026-09-30T15:00:00Z");
  });

  it("future 8/8 → 1/8 boundary is detected", () => {
    const s = resolveEffectiveVisitState(hub(6), [
      b("1", "2026-09-17", "6/8"),
      b("2", "2026-09-29", "7/8"),
      b("3", "2026-10-06", "8/8"),
      b("4", "2026-10-13", "1/8"),
    ], now);
    expect(s.nextPackageStart).toBe("2026-10-13T15:00:00Z");
  });

  it("no notes falls back to Hub", () => {
    const s = resolveEffectiveVisitState(hub(3), [b("1", "2026-09-10", "")], now);
    expect(s.source).toBe("hub_fallback");
    expect(s.visitsUsed).toBe(3);
  });

  it("skipped number is flagged but Square still drives", () => {
    const s = resolveEffectiveVisitState(hub(3), [b("1", "2026-09-03", "3/8"), b("2", "2026-09-17", "5/8")], now);
    expect(s.source).toBe("square");
    expect(s.reviewStatus).toBe("needs_review");
    expect(s.automationUsable).toBe(true);
    expect(drivingCounts(s).used).toBe(5);
  });

  it("old historical skip, clear latest position → Square drives, flagged", () => {
    const s = resolveEffectiveVisitState(hub(1), [
      b("1", "2026-08-01", "2/8"), b("2", "2026-08-08", "4/8"), b("3", "2026-08-15", "5/8"), b("4", "2026-09-20", "6/8"),
    ], now);
    expect(s.source).toBe("square");
    expect(s.reviewStatus).toBe("needs_review");
    expect(s.visitsUsed).toBe(6);
  });

  it("conflicting numbers on the latest date → Hub fallback, automation held", () => {
    const s = resolveEffectiveVisitState(hub(3), [
      b("1", "2026-09-10", "4/8"), { id: "2", start_at: "2026-09-17T14:00:00Z", seller_note: "5/8", status: "ACCEPTED" },
      { id: "3", start_at: "2026-09-17T16:00:00Z", seller_note: "2/8", status: "ACCEPTED" },
    ], now);
    expect(s.source).toBe("hub_fallback");
    expect(s.automationUsable).toBe(false);
    expect(s.suppressed).toBe(true);
    expect(drivingCounts(s)).toEqual({ used: 3, total: 8, nextPackageStart: null });
  });

  it("latest visit goes backward with no renewal → held", () => {
    const s = resolveEffectiveVisitState(hub(3), [b("1", "2026-09-10", "5/8"), b("2", "2026-09-17", "4/8")], now);
    expect(s.automationUsable).toBe(false);
  });

  it("cancelled numbered visit stays in the sequence", () => {
    const s = resolveEffectiveVisitState(hub(6), [
      b("1", "2026-09-02", "6/8"),
      b("2", "2026-09-09", "7/8", "CANCELLED_BY_SELLER"),
      b("3", "2026-09-16", "8/8"),
    ], now);
    expect(s.source).toBe("square");
    expect(s.visitsUsed).toBe(8);
  });
});

describe("downstream uses effective state", () => {
  const starts = ["2026-09-29T15:00:00Z", "2026-10-06T15:00:00Z", "2026-10-13T15:00:00Z"];

  it("Needs Renewal uses the Square count, not the stored Hub count", () => {
    const s = resolveEffectiveVisitState(hub(2), [b("1", "2026-09-10", "5/8"), b("2", "2026-09-17", "6/8")], now);
    const d = drivingCounts(s);
    const f = forecastRenewal({ upcomingStarts: starts, visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
    expect(f.needsRenewal).toBe(true);
    expect(f.firstUncoveredStart).toBe(starts[2]);
    // With the stale Hub count it would not need renewal yet.
    expect(forecastRenewal({ upcomingStarts: starts, visitsUsed: 2, totalVisits: 8, nextPackageStart: null }).needsRenewal).toBe(false);
  });

  it("dues/payment week timing follows the Square renewal boundary", () => {
    const f = forecastRenewal({ upcomingStarts: starts, visitsUsed: 8, totalVisits: 8, nextPackageStart: starts[0] });
    expect(f.firstUncoveredStart).toBe(starts[0]);
    expect(f.firstUncoveredIndex).toBe(0);
  });
});
