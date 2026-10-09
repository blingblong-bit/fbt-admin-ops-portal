import { describe, expect, it } from "vitest";
import { resolveEffectiveVisitState, visitTrackingFrom, countsAsMissedCheckIn } from "./effective-visit-state";

const NOW = "2026-09-25T15:00:00Z";
const b = (id: string, day: string, note: string | null, status = "ACCEPTED") => ({
  id, start_at: `${day}T15:00:00Z`, status, seller_note: note, customer_note: null,
});
const hub = { visits_used: 3, package_total_visits: 8 };

describe("check-in presentation", () => {
  it("Square synced → no manual check-in, not a missed check-in", () => {
    const v = visitTrackingFrom(resolveEffectiveVisitState(hub, [b("1", "2026-09-17", "2/8"), b("2", "2026-09-24", "3/8"), b("3", "2026-09-30", "4/8")], NOW));
    expect(v.mode).toBe("square");
    expect(v.manualCheckInNeeded).toBe(false);
    expect(countsAsMissedCheckIn(v)).toBe(false);
    expect(v.nextNote).toBe("4/8");
  });
  it("Square + Needs review with readable position → still no manual check-in", () => {
    const v = visitTrackingFrom(resolveEffectiveVisitState(hub, [b("1", "2026-09-10", "1/8"), b("2", "2026-09-17", "3/8"), b("3", "2026-09-24", "4/8")], NOW));
    expect(v.mode).toBe("square_review");
    expect(countsAsMissedCheckIn(v)).toBe(false);
  });
  it("Hub fallback → manual check-in and counts as missed", () => {
    const v = visitTrackingFrom(resolveEffectiveVisitState(hub, [b("1", "2026-09-24", null)], NOW));
    expect(v.mode).toBe("hub_fallback");
    expect(v.used).toBe(3);
    expect(countsAsMissedCheckIn(v)).toBe(true);
  });
  it("Unreadable position → held, manual check-in available", () => {
    const v = visitTrackingFrom(resolveEffectiveVisitState(hub, [b("1", "2026-09-17", "5/8"), b("2", "2026-09-24", "4/8")], NOW));
    expect(v.mode).toBe("held");
    expect(countsAsMissedCheckIn(v)).toBe(true);
  });
  it("no tracking info (Square unavailable) → keeps today's behavior", () => {
    expect(countsAsMissedCheckIn(null)).toBe(true);
  });
});

describe("Charles Parish: two cancellations rebooked in order", () => {
  it("cancelled 7/8 and 8/8 rebooked later → 6/8 used", () => {
    const s = resolveEffectiveVisitState({ visits_used: 2, package_total_visits: 8 }, [
      b("1", "2026-09-29", "5/8"), b("2", "2026-10-01", "6/8"),
      b("3", "2026-10-06", "7/8", "CANCELLED_BY_SELLER"), b("4", "2026-10-08", "8/8", "CANCELLED_BY_SELLER"),
      b("5", "2026-10-13", "7/8"), b("6", "2026-10-15", "8/8"),
    ], "2026-10-09T21:00:00Z");
    expect(s.visitsUsed).toBe(6); expect(s.remainingVisits).toBe(2); expect(s.source).toMatch(/square/);
  });
});
