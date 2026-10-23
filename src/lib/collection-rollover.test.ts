import { describe, expect, it } from "vitest";
import { collectionWeekStart } from "./work-week";
import { computeCollections } from "./collections";
import type { MasterDuesRow } from "./master-dues";

describe("Collections week rolls over at Saturday 00:00 Chicago", () => {
  it("Fri Oct 23 23:59:59 CDT is still the Oct 19 week", () =>
    expect(collectionWeekStart(new Date("2026-10-24T04:59:59Z"))).toBe("2026-10-19"));
  it("Sat Oct 24 00:00 CDT is the Oct 26 week", () =>
    expect(collectionWeekStart(new Date("2026-10-24T05:00:00Z"))).toBe("2026-10-26"));
  it("Sun and Mon stay on the new week", () => {
    expect(collectionWeekStart(new Date("2026-10-25T20:00:00Z"))).toBe("2026-10-26");
    expect(collectionWeekStart(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-26");
  });
  it("uses CST after DST ends (Fri Nov 6 23:59 vs Sat Nov 7 00:00 = UTC-6)", () => {
    expect(collectionWeekStart(new Date("2026-11-07T05:59:59Z"))).toBe("2026-11-02");
    expect(collectionWeekStart(new Date("2026-11-07T06:00:00Z"))).toBe("2026-11-09");
  });
  it("uses CDT after DST starts (Fri Mar 12 2027 23:59 vs Sat 00:00 = UTC-6, then Sat Mar 13)", () => {
    expect(collectionWeekStart(new Date("2027-03-13T05:59:59Z"))).toBe("2027-03-08");
    expect(collectionWeekStart(new Date("2027-03-13T06:00:00Z"))).toBe("2027-03-15");
  });
});

const row = (id: string, o: Partial<MasterDuesRow>): MasterDuesRow => {
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

describe("Weekend worklist = unpaid carried over + next week's new charges, no double count", () => {
  const rows = [
    row("a", { current: { amount: 100, status: "due_now", expected: "this_week" } }), // visit Wed Oct 21, unpaid
    row("b", { current: { amount: 50, status: "due_now", expected: "next_week" } }), // visit Tue Oct 27
    row("c", { renewal: { amount: 345, status: "upcoming", expected_ymd: "2026-10-28" } }),
    row("d", { previous: { amount: 80, status: "due_now" } }),
  ];
  const appts = { a: ["2026-10-21T15:00:00Z"], b: ["2026-10-27T15:00:00Z"] };

  it("Friday: a is this week, renewal c is next week", () => {
    const c = computeCollections(rows, appts, [], collectionWeekStart(new Date("2026-10-24T04:59:59Z")));
    expect(c.totals.thisWeekAll.dollars).toBe(230);
    expect(c.totals.nextWeek.dollars).toBe(345);
    expect(c.totals.sum).toBe(575);
  });
  it("Saturday: unpaid a rolls into carried-over, b and c become this week's scheduled", () => {
    const c = computeCollections(rows, appts, [], collectionWeekStart(new Date("2026-10-24T05:00:00Z")));
    expect(c.totals.pastDue.dollars).toBe(180); // a 100 + d 80
    expect(c.totals.thisWeek.dollars).toBe(395); // b 50 + c 345
    expect(c.totals.thisWeekAll.dollars).toBe(575);
    expect(c.totals.unexplained).toBe(0);
  });
  it("a weekend payment removes the amount live (no snapshot)", () => {
    const paid = rows.map((r) => (r.client_id === "a" ? row("a", {}) : r));
    const c = computeCollections(paid, appts, [], collectionWeekStart(new Date("2026-10-24T05:00:00Z")));
    expect(c.totals.pastDue.dollars).toBe(80);
  });
});
