import { describe, expect, it } from "vitest";
import { applyOverrides, applyOverridesToRows, blocksAutoActivation, needsConfirmation, type PackageOverride } from "./package-override";
import { decidePreparedActivation } from "./effective-visit-state";
import { computeMasterDues } from "./master-dues";

const raw: { visit_tracking_mode?: string | null; [k: string]: any } & { id: string } = {
  id: "c1", first_name: "T", last_name: "U", package_total_visits: 8, visits_used: 2, package_price: 375,
  amount_paid: 375, package_start_date: null, previous_package_owed: 0,
  pending_renewal_start_date: "2026-10-19", pending_renewal_total_visits: 8, pending_renewal_price: 375, pending_renewal_paid: 175,
};
const o = (p: Partial<PackageOverride>): PackageOverride => ({ slot: "current", total_visits: null, visits_used: null, price: null, recognized_paid: null, start_date: null, status: "active", ...p });
const dues = (c: object) => computeMasterDues([c as never], { todayYmd: "2026-10-23", nextAppointmentYmd: new Map(), renewalTiming: new Map([["c1", { kind: "started", ymd: "2026-10-19" }]]) });

describe("package overrides", () => {
  it("no overrides leaves the record untouched", () => {
    const e = applyOverrides(raw, []);
    expect(e.amount_paid).toBe(375);
    expect(e.has_override).toBe(false);
  });
  it("recognized paid replaces recorded paid, never adds to it (no duplicate Square money)", () => {
    const e = applyOverrides(raw, [o({ price: 375, recognized_paid: 200 })]);
    expect(e.amount_paid).toBe(200);
    expect(dues(e).rows[0].current.amount).toBe(175);
    expect(e.override_flags.length).toBe(1);
  });
  it("pending started by admin carries current balance once and becomes current", () => {
    const e = applyOverrides({ ...raw, amount_paid: 300 }, [o({ slot: "pending", total_visits: 4, visits_used: 2, price: 375, recognized_paid: 175, status: "active" })]);
    expect(e.package_total_visits).toBe(4);
    expect(e.visits_used).toBe(2);
    expect(e.previous_package_owed).toBe(75);
    expect(e.pending_renewal_start_date).toBeNull();
    const r = dues(e).rows[0];
    expect(r.previous.amount + r.current.amount + r.renewal.amount).toBe(75 + 200);
  });
  it("prepared pending override edits renewal figures only", () => {
    const e = applyOverrides(raw, [o({ slot: "pending", total_visits: 4, price: 375, recognized_paid: 175, status: "prepared" })]);
    expect(e.pending_renewal_total_visits).toBe(4);
    expect(e.package_total_visits).toBe(8);
  });
  it("prior package override sets owed = price - recognized paid", () => {
    expect(applyOverrides(raw, [o({ slot: "previous", price: 375, recognized_paid: 175, status: "completed" })]).previous_package_owed).toBe(200);
  });
  it("active override blocks automatic activation, even on Square 1/N", () => {
    expect(blocksAutoActivation([{ slot: "current" }])).toBe(true);
    expect(blocksAutoActivation([{ slot: "previous" }])).toBe(false);
    const d = decidePreparedActivation({ visitYmd: "2026-10-20", preparedStartYmd: "2026-10-19", note: { status: "numbered", n: 1, total: 8 } as never, hubUsed: 8, hubTotal: 8, evidence: null, adminOverride: true });
    expect(d.action).toBe("hold");
  });
  it("without an override, 1/N still activates (auto-renewal kept)", () => {
    const d = decidePreparedActivation({ visitYmd: "2026-10-20", preparedStartYmd: "2026-10-19", note: { status: "numbered", n: 1, total: 8 } as never, hubUsed: 8, hubTotal: 8, evidence: null });
    expect(d.action).toBe("activate");
  });
  it("cleared override (removed from the active list) resumes raw figures", () => {
    expect(applyOverrides(raw, []).amount_paid).toBe(375);
  });
  it("confirmation only for paid or status changes", () => {
    const before = o({ price: 375, recognized_paid: 375 });
    expect(needsConfirmation(before, o({ price: 400, recognized_paid: 375 }))).toBe(false);
    expect(needsConfirmation(before, o({ recognized_paid: 200 }))).toBe(true);
    expect(needsConfirmation(before, o({ recognized_paid: 375, status: "completed" }))).toBe(true);
  });
});

describe("override consistency across screens", () => {
  const ovr = [{ client_id: "c1", ...o({ slot: "pending", total_visits: 4, visits_used: 1, price: 375, recognized_paid: 175, status: "active" }) }];
  it("profile, renewals and dues read the same effective package", () => {
    const [row] = (applyOverridesToRows([raw], ovr));
    const prof = applyOverrides(raw, ovr);
    expect(row.package_total_visits).toBe(prof.package_total_visits);
    expect(row.pending_renewal_start_date).toBeNull(); // drops out of Scheduled
    const r = dues(row).rows[0];
    expect(r.renewal.amount).toBe(0);
    expect(r.current.amount).toBe(200);
  });
  it("forces Hub visit tracking so Square notes can't contradict admin figures", () => {
    expect(applyOverrides(raw, [o({ visits_used: 3 })]).visit_tracking_mode).toBe("hub");
    expect(applyOverrides(raw, [o({ slot: "previous", price: 1, recognized_paid: 0 })]).visit_tracking_mode).toBeUndefined();
  });
  it("check-ins after the override keep counting on top of the admin figure, capped", () => {
    const c = { ...raw, visits_used: 4 };
    expect(applyOverrides(c, [o({ visits_used: 1, baseline_visits_used: 2 })]).visits_used).toBe(3);
    expect(applyOverrides({ ...raw, visits_used: 20 }, [o({ visits_used: 7, baseline_visits_used: 2 })]).visits_used).toBe(8);
  });
  it("non-overridden rows are returned unchanged", () => {
    expect(applyOverridesToRows([raw], [])[0]).toBe(raw);
  });
});
