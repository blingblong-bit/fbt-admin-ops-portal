import { describe, expect, it } from "vitest";
import { computeCollections } from "./collections";
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

const rows = [
  // Old debt + current balance with a visit this week: split across two cards, no double count.
  row("split", { previous: { amount: 80, status: "due_now" }, current: { amount: 40, status: "due_now", expected: "this_week" } }),
  row("unsched", { current: { amount: 60, status: "due_now", expected: "unknown" } }),
  row("future", { renewal: { amount: 300, status: "upcoming", expected_ymd: "2026-11-03" } }),
  row("prep", { renewal: { amount: 200, status: "prepared", expected_ymd: null } }),
  row("review", { renewal: { amount: 150, status: "needs_review", expected_ymd: null } }),
  row("paid"),
];
const appts = { split: ["2026-10-21T15:00:00Z"] };

describe("Collections Hub buckets", () => {
  const c = computeCollections(rows, appts, [], W);
  it("cards add up to the Master Dues total with no difference", () => {
    expect(c.totals.masterTotal).toBe(830);
    expect(c.totals.sum).toBe(830);
    expect(c.totals.unexplained).toBe(0);
  });
  it("a $120 client with $80 old debt and $40 due at this week's visit is split, not doubled", () => {
    expect(c.totals.pastDue.dollars).toBe(140); // 80 old debt + 60 unscheduled
    expect(c.totals.thisWeek.dollars).toBe(40);
  });
  it("future and prepared renewals are never past due or this week", () => {
    expect(c.totals.upcoming.dollars).toBe(500);
    expect(c.items.filter((i) => ["future", "prep"].includes(i.client_id)).every((i) => i.group === "upcoming")).toBe(true);
  });
  it("needs-review renewals stay in Needs Review", () => expect(c.totals.review.dollars).toBe(150));
  it("paid clients show nowhere", () => expect(c.items.some((i) => i.client_id === "paid")).toBe(false));
  it("a cancelled visit (not in the appointment list) does not make a balance due this week", () => {
    const x = computeCollections([row("h", { current: { amount: 50, status: "due_now", expected: "unknown" } })], {}, [], W);
    expect(x.totals.thisWeek.dollars).toBe(0);
  });
});

const ob = (ymd: string, open: number) => ({ ymd, kind: "visit" as const, open, status: "due_now", expected: "past" });
const ppv = (id: string, obs: ReturnType<typeof ob>[]) =>
  row(id, { billing: { type: "pay_per_visit", amount: obs.reduce((s, o) => s + o.open, 0), due_now: 0, carryover: 0, this_week: 0, next_week: 0, obligations: obs } });

describe("Collections: This Week / Next Week / Due now", () => {
  const mix = [
    row("old", { previous: { amount: 80, status: "due_now" } }),
    row("cur", { current: { amount: 100, status: "due_now", expected: "next_week" } }),
    row("ren", { renewal: { amount: 345, status: "upcoming", expected_ymd: "2026-10-28" } }),
    row("prep", { renewal: { amount: 200, status: "prepared", expected_ymd: "2026-10-27" } }),
    ppv("p", [ob("2026-10-20", 40), ob("2026-10-27", 40), ob("2026-11-10", 40)]),
  ];
  const appts = { old: ["2026-10-27T15:00:00Z"], cur: ["2026-10-28T15:00:00Z"] };
  const c = computeCollections(mix, appts, [], W);

  it("older unpaid balances with a next-week visit stay in This Week / Due now, never Next Week", () => {
    const nx = c.items.filter((i) => i.group === "nextWeek").map((i) => i.client_id);
    expect(nx).not.toContain("old");
    expect(nx).not.toContain("cur");
    expect(c.totals.pastDue.dollars).toBe(180);
  });
  it("Next Week holds only new items expected next week", () => {
    expect(c.totals.nextWeek.dollars).toBe(385); // 345 renewal + 40 per-visit on 10/27
  });
  it("prepared renewals are never Next Week", () => expect(c.items.find((i) => i.client_id === "prep")?.group).toBe("upcoming"));
  it("Due now is a part of This Week, not added on top", () => {
    expect(c.totals.thisWeekAll.dollars).toBe(r2(c.totals.thisWeek.dollars + c.totals.pastDue.dollars));
    expect(c.totals.pastDue.dollars).toBeLessThanOrEqual(c.totals.thisWeekAll.dollars);
  });
  it("buckets are disjoint and reconcile to the Master total", () => {
    const ids = c.items.map((i) => `${i.client_id}|${i.kind}|${i.ymd}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.totals.sum).toBe(c.totals.masterTotal);
    expect(c.totals.unexplained).toBe(0);
  });
  it("rollover: a Mon charge is This Week, then Carryover next week, then Older", () => {
    const one = [ppv("r", [ob("2026-10-19", 50)])];
    const g = (wk: string) => computeCollections(one, {}, [], wk).items[0];
    expect(g("2026-10-12").group).toBe("nextWeek");
    expect(g("2026-10-19").group).toBe("thisWeek");
    expect(g("2026-10-26")).toMatchObject({ group: "pastDue", section: "carryover" });
    expect(g("2026-11-02")).toMatchObject({ group: "pastDue", section: "older" });
  });
  it("a Saturday charge counts toward the following Monday's week", () => {
    const x = computeCollections([ppv("s", [ob("2026-10-24", 30)])], {}, [], W);
    expect(x.items[0].group).toBe("nextWeek");
  });
});
const r2 = (n: number) => Math.round(n * 100) / 100;
