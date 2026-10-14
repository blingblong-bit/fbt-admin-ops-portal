import { describe, expect, it } from "vitest";
import { resolveEffectiveVisitState } from "./effective-visit-state";
import { shouldActivateRenewal } from "./master-dues";

const NOW = "2026-10-14T20:00:00Z";
const b = (id: string, day: string, note: string | null, status = "ACCEPTED") => ({ id, start_at: `${day}T15:00:00Z`, status, seller_note: note, customer_note: null });
const hub = { visits_used: 4, package_total_visits: 8 };
const run = (bs: any[], now = NOW) => resolveEffectiveVisitState(hub, bs, now);
const base = [b("5", "2026-09-21", "5 of 8"), b("6", "2026-09-25", "6 of 8"), b("7", "2026-09-28", "7 of 8"), b("8", "2026-10-01", "8 of 8")];

describe("same-size package boundary", () => {
  it("7/8 → 8/8 → 1/8 → 2/8 → 3/8 = new package at 3/8", () => {
    const s = run([...base, b("a", "2026-10-07", "1 of 8"), b("b", "2026-10-08", "2 of 8"), b("c", "2026-10-14", "3 of 8")]);
    expect(s.visitsUsed).toBe(3);
    expect(s.currentPackageStart?.slice(0, 10)).toBe("2026-10-07");
  });
  it("prepared renewal activates from that boundary", () => {
    const s = run([...base, b("a", "2026-10-07", "1 of 8"), b("b", "2026-10-08", "2 of 8")]);
    expect(shouldActivateRenewal({ id: "e", first_name: "", last_name: "", pending_renewal_price: 375 }, s.currentPackageStart ? { kind: "started", ymd: "2026-10-07" } : undefined)).toBe(true);
  });
  it("future 1/8 does not start before its time", () => {
    const s = run([...base, b("a", "2026-10-20", "1 of 8")]);
    expect(s.currentPackageStart).toBeNull();
    expect(s.nextPackageStart?.slice(0, 10)).toBe("2026-10-20");
  });
  it("stray 1/8 before old package completion does not reset", () => {
    const s = run([b("5", "2026-09-21", "5 of 8"), b("x", "2026-09-23", "1 of 8"), b("6", "2026-09-25", "6 of 8")]);
    expect(s.currentPackageStart).toBeNull();
  });
  it("cancelled 1/8 is never a start", () => {
    const s = run([...base, b("a", "2026-10-07", "1 of 8", "CANCELLED_BY_CUSTOMER")]);
    expect(s.currentPackageStart).toBeNull();
  });
  it("8/8 → unnumbered → 1/8 still detects the boundary", () => {
    const s = run([...base, b("u", "2026-10-03", null), b("a", "2026-10-07", "1 of 8"), b("b", "2026-10-08", "2 of 8")]);
    expect(s.currentPackageStart?.slice(0, 10)).toBe("2026-10-07");
  });
  it("8/8 → cancelled duplicate → 1/8 keeps the boundary", () => {
    const s = run([...base, b("d", "2026-10-03", "8 of 8", "CANCELLED_BY_SELLER"), b("a", "2026-10-07", "1 of 8"), b("b", "2026-10-08", "2 of 8")]);
    expect(s.currentPackageStart?.slice(0, 10)).toBe("2026-10-07");
  });
});

import { forecastRenewal, drivingCounts } from "./effective-visit-state";
import { renewalTimingFor } from "./master-dues";
describe("prepared renewal timing vs completed boundary (Jay)", () => {
  const jay = [
    b("a", "2026-08-21", "8 of 8"), b("1", "2026-08-26", "1 of 8"), b("2", "2026-09-09", "2 of 8"), b("3", "2026-09-11", "3 of 8"),
    b("4", "2026-09-16", "4 of 8"), b("5", "2026-09-18", "5 of 8"), b("6", "2026-09-23", "6 of 8"), b("7", "2026-09-25", "7 of 8"),
    b("8", "2026-09-30", "8 of 8"), b("x", "2026-10-06", "1 of 8", "CANCELLED_BY_SELLER"), b("n", "2026-10-28", "1 of 8"),
  ];
  const client = { pending_renewal_price: 345, pending_renewal_start_date: "2026-10-06", package_start_date: "2026-06-17" };
  const timing = (bs: any[], now: string) => {
    const s = resolveEffectiveVisitState({ visits_used: 3, package_total_visits: 8 }, bs, now);
    const d = drivingCounts(s);
    const ups = bs.filter((x) => x.start_at > now && x.status === "ACCEPTED").map((x) => x.start_at);
    const f = forecastRenewal({ upcomingStarts: ups, visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
    return renewalTimingFor(client, { suppressed: s.suppressed, ...d, firstUncoveredStart: f.firstUncoveredStart }, now);
  };
  it("completed 8/26 package → Upcoming 10/28, not Due Now", () => {
    expect(timing(jay, NOW)).toMatchObject({ kind: "upcoming", ymd: "2026-10-28" });
  });
  it("after the 10/28 1/8 starts → started", () => {
    expect(timing(jay, "2026-10-28T16:00:00Z").kind).toBe("started");
  });
  it("Emma pattern still in progress → started", () => {
    expect(timing([...base, b("e1", "2026-10-07", "1 of 8"), b("e2", "2026-10-08", "2 of 8"), b("e3", "2026-10-14", "3 of 8")], NOW)).toMatchObject({ kind: "started", ymd: "2026-10-07" });
  });
  it("completed package, nothing booked → prepared, never due now", () => {
    expect(timing(jay.slice(0, 9), NOW).kind).toBe("no_start");
  });
});
