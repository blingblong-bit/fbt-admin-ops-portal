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
