import { describe, expect, it } from "vitest";
import { computeMasterDues, type MasterDuesClient, type RenewalTiming } from "./master-dues";

const today = "2026-10-13"; // Tuesday
const base = (id: string, o: Partial<MasterDuesClient> = {}): MasterDuesClient => ({
  id, first_name: id, last_name: "X", status: "active", payment_model: "package",
  package_total_visits: 8, package_price: 375, amount_paid: 375, previous_package_owed: 0, ...o,
});
const run = (cs: MasterDuesClient[], appts: Record<string, string> = {}, timing: Record<string, RenewalTiming> = {}) =>
  computeMasterDues(cs, {
    todayYmd: today,
    nextAppointmentYmd: new Map(Object.entries(appts)),
    renewalTiming: new Map(Object.entries(timing)),
  });
const up = (ymd: string): RenewalTiming => ({ kind: "upcoming", ymd });

describe("computeMasterDues", () => {
  it("1. current balance only", () => {
    const r = run([base("a", { amount_paid: 200 })]).rows[0];
    expect(r.current).toMatchObject({ amount: 175, status: "due_now" });
    expect(r.total).toBe(175);
  });
  it("2. renewal balance only", () => {
    const r = run([base("a", { pending_renewal_price: 375 })], {}, { a: up("2026-10-20") }).rows[0];
    expect(r.renewal).toMatchObject({ amount: 375, status: "upcoming" });
    expect(r.total).toBe(375);
  });
  it("3. previous debt only", () => {
    expect(run([base("a", { previous_package_owed: 50 })]).rows[0].previous).toMatchObject({ amount: 50, status: "due_now" });
  });
  it("4. current + renewal keep separate status on one row", () => {
    const out = run([base("a", { amount_paid: 200, pending_renewal_price: 375 })], { a: "2026-10-21" }, { a: up("2026-10-20") });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].current).toMatchObject({ status: "due_now", expected: "next_week" });
    expect(out.rows[0].renewal).toMatchObject({ status: "upcoming", expected_ymd: "2026-10-20" });
    expect(out.rows[0].total).toBe(550);
  });
  it("5. prepaid renewal subtracts", () => {
    expect(run([base("a", { pending_renewal_price: 375, pending_renewal_paid: 100 })], {}, { a: up("2026-10-20") }).rows[0].renewal.amount).toBe(275);
  });
  it("6. fully prepaid renewal contributes $0", () => {
    expect(run([base("a", { pending_renewal_price: 375, pending_renewal_paid: 375 })], {}, { a: up("2026-10-20") }).rows).toEqual([]);
  });
  it("7. future renewal appears as Upcoming", () => {
    expect(run([base("a", { pending_renewal_price: 300 })], {}, { a: up("2026-11-10") }).rows[0].renewal.status).toBe("upcoming");
  });
  it("8. same-week renewal is Upcoming with this week's date", () => {
    const r = run([base("a", { pending_renewal_price: 300 })], {}, { a: up("2026-10-15") }).rows[0];
    expect(r.renewal).toMatchObject({ status: "upcoming", expected_ymd: "2026-10-15" });
  });
  it("9. current debt is Due now even when the next appointment is next week", () => {
    expect(run([base("a", { amount_paid: 0 })], { a: "2026-10-20" }).rows[0].current).toMatchObject({ status: "due_now", expected: "next_week" });
  });
  it("10. one client never creates duplicate rows", () => {
    const c = base("a", { amount_paid: 0, previous_package_owed: 20, pending_renewal_price: 300 });
    expect(run([c, c], {}, { a: { kind: "started", ymd: "2026-10-01" } }).rows).toHaveLength(1);
  });
  it("11. reconciliation has no double counting", () => {
    const out = run(
      [base("a", { amount_paid: 0, previous_package_owed: 20 }), base("b", { pending_renewal_price: 300 }), base("c", { package_price: 0 })],
      {},
      { b: { kind: "unknown", ymd: null } },
    );
    expect(out.totals.total).toBe(695);
    expect(out.unexplained).toBe(0);
    expect(out.rows.find((r) => r.client_id === "b")?.renewal.status).toBe("needs_review");
    expect(out.exceptions.map((e) => e.kind)).toEqual(["package_info_needed"]);
  });
  it("prepared renewal with stale past date and no uncovered appointment is Prepared, not overdue", () => {
    const r = run(
      [base("a", { pending_renewal_price: 345, pending_renewal_start_date: "2026-10-02" })],
      {},
      { a: { kind: "no_start", ymd: null } },
    ).rows[0];
    expect(r.renewal).toMatchObject({ amount: 345, status: "prepared" });
  });
  it("only a concrete Square start makes a renewal Due now", () => {
    expect(run([base("a", { pending_renewal_price: 345 })], {}, { a: { kind: "started", ymd: "2026-10-09" } }).rows[0].renewal.status).toBe("due_now");
  });
});
