import { describe, expect, it } from "vitest";
import { clientVisitProgress } from "./client-visit-progress";
import { resolveEffectiveVisitState, visitTrackingFrom } from "./effective-visit-state";

const client = { visits_used: 4, package_total_visits: 9 };
const bookings = [
  { id: "a", start_at: "2026-11-11T15:00:00Z", status: "ACCEPTED", seller_note: "5/9" },
  { id: "b", start_at: "2026-11-13T15:00:00Z", status: "ACCEPTED", seller_note: "6/9" },
  { id: "c", start_at: "2026-11-17T15:00:00Z", status: "ACCEPTED", seller_note: "7/9" },
];
const now = "2026-11-14T17:07:00Z";
describe("client search progress matches profile tracking", () => {
  it("shows Square 6/9 instead of stored 4/9 without counting the future visit", () => {
    const visit = visitTrackingFrom(resolveEffectiveVisitState(client, bookings, now));
    expect(clientVisitProgress(client, visit)).toBe("6 / 9");
    expect(client.visits_used).toBe(4);
  });
  it("keeps explicit Hub manual tracking", () => {
    const visit = visitTrackingFrom(resolveEffectiveVisitState({ ...client, visit_tracking_mode: "hub" }, bookings, now));
    expect(clientVisitProgress(client, visit)).toBe("4 / 9");
  });
  it("falls back to Hub when Square notes are missing", () => {
    const visit = visitTrackingFrom(resolveEffectiveVisitState(client, [], now));
    expect(clientVisitProgress(client, visit)).toBe("4 / 9");
  });
  it("does not replace Hub with an unreadable Square position", () => {
    const visit = visitTrackingFrom(resolveEffectiveVisitState(client, [bookings[0], { ...bookings[1], seller_note: "4/9" }], now));
    expect(visit.mode).toBe("held");
    expect(clientVisitProgress(client, visit)).toBe("4 / 9");
  });
  it("preserves unknown Hub progress when tracking is unavailable", () => {
    expect(clientVisitProgress({ visits_used: null, package_total_visits: 9 }, null)).toBe("—");
  });
});