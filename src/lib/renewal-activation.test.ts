import { describe, expect, it } from "vitest";
import { activatedState, computeMasterDues, shouldActivateRenewal, type MasterDuesClient } from "./master-dues";
import { sortRows, makeWeekOf } from "./master-dues-view";
import { addDaysYmd, workWeekStartFromYmd } from "./work-week";

const c = (o: Partial<MasterDuesClient> = {}): MasterDuesClient => ({
  id: "e", first_name: "Emma", last_name: "S", status: "active", payment_model: "package",
  package_total_visits: 8, package_price: 375, amount_paid: 375, previous_package_owed: 0,
  pending_renewal_price: 375, pending_renewal_start_date: "2026-10-07", ...o,
});
const ctx = { todayYmd: "2026-10-14", nextAppointmentYmd: new Map(), renewalTiming: new Map() };
const owed = (x: MasterDuesClient) => computeMasterDues([x], ctx).totals.total;
const started = { kind: "started" as const, ymd: "2026-10-07" };

describe("renewal activation", () => {
  it("fully prepaid → $0 owed", () => {
    const a = activatedState(c({ pending_renewal_paid: 375 }));
    expect(owed(a)).toBe(0);
  });
  it("partially prepaid → remaining balance", () => expect(owed(activatedState(c({ pending_renewal_paid: 200 })))).toBe(175));
  it("unpaid → full balance", () => expect(owed(activatedState(c({ pending_renewal_paid: 0 })))).toBe(375));
  it("stored date passed without start evidence stays prepared", () => {
    expect(shouldActivateRenewal(c(), { kind: "no_start", ymd: null })).toBe(false);
    expect(shouldActivateRenewal(c(), undefined)).toBe(false);
    expect(shouldActivateRenewal(c(), started)).toBe(true);
  });
  it("clears pending fields", () => {
    const a = activatedState(c({ pending_renewal_paid: 100 }));
    expect([a.pending_renewal_price, a.pending_renewal_paid, a.pending_renewal_start_date]).toEqual([null, 0, null]);
  });
  it("no double counting", () => {
    const before = computeMasterDues([c({ pending_renewal_paid: 100 })], { ...ctx, renewalTiming: new Map([["e", started]]) }).totals.total;
    expect(owed(activatedState(c({ pending_renewal_paid: 100 })))).toBe(before);
  });
  it("activated client leaves Renewal Scheduled (no pending renewal)", () => {
    const a = activatedState(c());
    expect(Number(a.pending_renewal_price ?? 0) > 0 || !!a.pending_renewal_start_date).toBe(false);
  });
});

describe("All sorting", () => {
  const k = (id: string, o: Partial<MasterDuesClient>) => c({ id, first_name: id, pending_renewal_price: null, pending_renewal_start_date: null, ...o });
  const out = computeMasterDues(
    [k("review", { pending_renewal_price: 10 }), k("prep", { pending_renewal_price: 10 }), k("later", { pending_renewal_price: 10 }),
     k("next", { pending_renewal_price: 10 }), k("thisB", { pending_renewal_price: 10 }), k("thisA", { pending_renewal_price: 10 }), k("due", { amount_paid: 0 })],
    { ...ctx, renewalTiming: new Map([
      ["review", { kind: "unknown", ymd: null }], ["prep", { kind: "no_start", ymd: null }], ["later", { kind: "upcoming", ymd: "2026-11-10" }],
      ["next", { kind: "upcoming", ymd: "2026-10-20" }], ["thisB", { kind: "upcoming", ymd: "2026-10-16" }], ["thisA", { kind: "upcoming", ymd: "2026-10-16" }],
    ] as any) },
  );
  it("follows priority order, date, then name", () => {
    const wo = makeWeekOf("2026-10-14", workWeekStartFromYmd, addDaysYmd);
    expect(sortRows(out.rows, wo).map((r) => r.client_id)).toEqual(["due", "thisA", "thisB", "next", "later", "prep", "review"]);
  });
});

describe("activation with visits used", () => {
  it("p_visits_used=3 → new package at 3/N, totals unchanged", () => {
    const base = c({ pending_renewal_paid: 200, pending_renewal_total_visits: 8 } as any);
    const a0 = activatedState(base);
    const a3 = activatedState(base, { visitsUsed: 3, startYmd: "2026-10-07" });
    expect(a3.visits_used).toBe(3);
    expect(a3.package_total_visits).toBe(8);
    expect(a3.package_start_date).toBe("2026-10-07");
    expect(a0.visits_used).toBe(0);
    expect(owed(a3)).toBe(owed(a0));
  });
});
