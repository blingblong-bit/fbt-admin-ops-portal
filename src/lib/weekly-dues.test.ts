import { describe, expect, it } from "vitest";
import { computeWeeklyDues } from "./weekly-dues";
import type { MasterDuesRow } from "./master-dues";

const W = "2026-10-19";
const row = (id: string, o: Partial<MasterDuesRow> = {}): MasterDuesRow => {
  const r: MasterDuesRow = {
    client_id: id, name: id,
    previous: { amount: 0, status: "none" },
    current: { amount: 0, status: "none", expected: null },
    renewal: { amount: 0, status: "none", expected_ymd: null },
    billing: { type: null, amount: 0, due_now: 0, carryover: 0, this_week: 0, next_week: 0, obligations: [] },
    total: 0, reasons: [], ...o,
  };
  r.total = r.previous.amount + r.current.amount + r.renewal.amount + r.billing.amount;
  return r;
};
const ob = (ymd: string, open: number, kind: "visit" | "week" = "visit") => ({ ymd, kind, open, status: "due_now", expected: "past" });
const bill = (type: "pay_per_visit" | "weekly", obs: ReturnType<typeof ob>[]) => ({
  type, amount: obs.reduce((s, o) => s + o.open, 0), due_now: 0, carryover: 0, this_week: 0, next_week: 0, obligations: obs,
});

describe("computeWeeklyDues", () => {
  it("current balance goes to expected only with an appointment that week", () => {
    const r = computeWeeklyDues([row("a", { current: { amount: 100, status: "due_now", expected: "next_week" } }), row("b", { current: { amount: 50, status: "due_now", expected: "unknown" } })],
      { a: ["2026-10-21T15:00:00Z"] }, W);
    expect(r.items.find((i) => i.client_id === "a")).toMatchObject({ section: "expected", ymd: "2026-10-21" });
    expect(r.items.find((i) => i.client_id === "b")?.section).toBe("older");
    expect(r.totals.unexplained).toBe(0);
  });
  it("prior-week obligation stays in carryover even with no appointment this week", () => {
    const r = computeWeeklyDues([row("a", { billing: bill("pay_per_visit", [ob("2026-10-14", 40), ob("2026-10-05", 40), ob("2026-10-20", 40)]) })], {}, W);
    expect(r.totals).toMatchObject({ carryover: 40, older: 40, expected: 40, unexplained: 0 });
  });
  it("carryover uses open (unpaid) amount only; paid obligations vanish", () => {
    const r = computeWeeklyDues([row("a", { billing: bill("weekly", [ob("2026-10-12", 30, "week"), ob("2026-10-12", 0, "week")]) })], {}, W);
    expect(r.totals.carryover).toBe(30);
  });
  it("weekly billing counts once for the week", () => {
    const r = computeWeeklyDues([row("a", { billing: bill("weekly", [ob("2026-10-19", 80, "week")]) })], { a: ["2026-10-20T15:00:00Z", "2026-10-22T15:00:00Z"] }, W);
    expect(r.items.filter((i) => i.section === "expected")).toHaveLength(1);
    expect(r.totals.expected).toBe(80);
  });
  it("prepared / out-of-week upcoming renewals are not actionable", () => {
    const r = computeWeeklyDues([
      row("a", { renewal: { amount: 375, status: "prepared", expected_ymd: "2026-10-20" } }),
      row("b", { renewal: { amount: 375, status: "upcoming", expected_ymd: "2026-10-28" } }),
      row("c", { renewal: { amount: 345, status: "upcoming", expected_ymd: "2026-10-22" } }),
    ], {}, W);
    expect(r.totals).toMatchObject({ expected: 345, carryover: 0, older: 0, excluded: 750, unexplained: 0 });
  });
  it("sections are mutually exclusive and reconcile to the master total", () => {
    const rows = [row("a", { previous: { amount: 200, status: "due_now" }, current: { amount: 100, status: "due_now", expected: "this_week" }, renewal: { amount: 345, status: "due_now", expected_ymd: "2026-10-13" } })];
    const r = computeWeeklyDues(rows, { a: ["2026-10-19T14:00:00Z"] }, W);
    expect(r.items.map((i) => i.section).sort()).toEqual(["carryover", "expected", "older"]);
    expect(r.totals.total).toBe(645);
    expect(r.totals.unexplained).toBe(0);
  });
});
