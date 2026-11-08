import { describe, expect, it } from "vitest";
import { preparedEditAmounts, preparedEditGuard, preparationTimestamp } from "./prepared-renewal-edit";
import { applyOverrides, type PackageOverride } from "./package-override";
import { computeMasterDues } from "./master-dues";
import { computeCollections } from "./collections";
import { decideOverridePendingStart } from "./square-activation";
import { buildSequence } from "./square-visit-audit";

const now = "2026-11-08T01:46:00Z";
const booking = (date: string, note: string) => ({ id: date, start_at: `${date}T21:45:00Z`, status: "ACCEPTED", seller_note: note });
const bookings = [booking("2026-10-21", "1 of 4"), booking("2026-11-05", "4 of 4"), booking("2026-11-10", "1 of 4")];
const raw = { id: "abby", first_name: "Abby", last_name: "Quick", square_customer_id: "sq", visit_tracking_mode: "auto", package_total_visits: 4, visits_used: 0, package_price: 200, amount_paid: 200, package_start_date: "2026-09-30", previous_package_owed: 0, pending_renewal_start_date: "2026-10-05", pending_renewal_total_visits: 4, pending_renewal_price: 200, pending_renewal_paid: 300 };
const correction: PackageOverride & { id: string; created_at: string } = { id: "correction", slot: "pending", total_visits: 4, visits_used: null, price: 200, recognized_paid: 0, start_date: "2026-11-10", status: "prepared", created_at: now, raw_baseline: { amount_paid: 200, pending_paid: 300, prev_owed: 0 } };
const ctx = { todayYmd: "2026-11-07", nextAppointmentYmd: new Map([["abby", "2026-11-10"]]), renewalTiming: new Map([["abby", { kind: "upcoming" as const, ymd: "2026-11-10" }]]) };

describe("prepared renewal edits", () => {
  it("blocks Abby's stale $300 prepaid from silent reuse", () => {
    expect(preparedEditGuard({ prepaid: 300, gate: "2026-10-05", bookings, nowIso: now })).toContain("older cycle");
    expect(computeMasterDues([raw], ctx).totals.total).toBe(0);
  });
  it("legitimate same-cycle $100 prepaid survives price edits and rescheduling", () => {
    expect(preparedEditGuard({ prepaid: 100, gate: "2026-11-10", bookings, nowIso: now })).toBeNull();
    expect(preparedEditAmounts(200, 100)).toEqual({ price: 200, prepaid: 100, due: 100 });
  });
  it("keeps original creation timestamp for an existing preparation", () => {
    expect(preparationTimestamp("2026-09-30T21:37:58Z", now)).toBe("2026-09-30T21:37:58Z");
    expect(preparationTimestamp(null, now)).toBe(now);
  });
  it("lookup failure and conflicting seller/customer notes require reconciliation", () => {
    expect(preparedEditGuard({ prepaid: 100, gate: "2026-11-10", bookings: null, nowIso: now })).not.toBeNull();
    expect(preparedEditGuard({ prepaid: 100, gate: "2026-11-10", bookings: [{ ...booking("2026-11-10", "1 of 4"), customer_note: "2 of 4" }], nowIso: now })).toContain("ambiguous");
  });
  it("does not bypass existing audited pending corrections", () => {
    expect(preparedEditGuard({ prepaid: 0, gate: "2026-11-10", bookings, nowIso: now, hasPendingOverride: true })).toContain("audited correction");
  });
  it("corrected Nov 10 cycle owes $200 exactly once in Nov 9–13; October stays paid", () => {
    const eff = applyOverrides(raw, [correction]);
    const master = computeMasterDues([eff, eff], ctx);
    const collection = computeCollections(master.rows, { abby: ["2026-11-10T21:45:00Z"] }, master.exceptions, "2026-11-09");
    expect(master.rows).toHaveLength(1);
    expect(master.rows[0].renewal).toMatchObject({ amount: 200, expected_ymd: "2026-11-10", status: "upcoming" });
    expect(collection.totals.thisWeekAll.dollars).toBe(200);
    expect(eff.amount_paid).toBe(200);
    expect(eff.package_start_date).toBe("2026-09-30");
    expect(eff.visit_tracking_mode).toBe("auto");
    expect(raw.pending_renewal_paid).toBe(300);
  });
  it("new $200 receipt over correction baseline pays this cycle once", () => {
    const eff = applyOverrides({ ...raw, pending_renewal_paid: 500 }, [correction]);
    expect(eff.pending_renewal_paid).toBe(200);
    expect(computeMasterDues([eff], ctx).totals.total).toBe(0);
  });
  it("future opener cannot activate; past verified opener promotes corrected $200/0 figures", () => {
    const resolve = (at: string) => decideOverridePendingStart({ client: raw, overrides: [correction], seq: buildSequence(bookings, at), currentUnreadable: false });
    expect(resolve(now).kind).toBe("not_ready");
    const first = resolve("2026-11-11T00:00:00Z");
    expect(first).toMatchObject({ kind: "activate", startYmd: "2026-11-10", figures: { price: 200, recognized_paid: 0, prev_owed: 0 } });
    expect(resolve("2026-11-11T00:00:00Z")).toEqual(first);
    const promoted: PackageOverride = { ...correction, slot: "current", status: "active", square_booking_id: "2026-11-10", recognized_paid: 0 };
    const eff = applyOverrides(raw, [promoted]);
    expect(eff.pending_renewal_start_date).toBeNull();
    expect(computeMasterDues([eff], ctx).totals.total).toBe(200);
    expect(decideOverridePendingStart({ client: raw, overrides: [promoted], seq: buildSequence(bookings, "2026-11-11T00:00:00Z"), currentUnreadable: false }).kind).toBe("skip");
  });
});