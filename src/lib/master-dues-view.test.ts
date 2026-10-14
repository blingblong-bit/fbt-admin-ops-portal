import { describe, expect, it } from "vitest";
import { computeMasterDues, type MasterDuesClient } from "./master-dues";
import { matchesFilter, sumRows } from "./master-dues-view";

const c = (id: string, o: Partial<MasterDuesClient> = {}): MasterDuesClient => ({
  id, first_name: id, last_name: "X", status: "active", payment_model: "package",
  package_total_visits: 8, package_price: 375, amount_paid: 375, previous_package_owed: 0, ...o,
});

describe("Payment Due view", () => {
  const out = computeMasterDues(
    [c("a", { amount_paid: 200 }), c("b", { pending_renewal_price: 345 }), c("d", { previous_package_owed: 50, pending_renewal_price: 300 })],
    {
      todayYmd: "2026-10-14",
      nextAppointmentYmd: new Map([["a", "2026-10-21"]]),
      renewalTiming: new Map([["b", { kind: "upcoming", ymd: "2026-10-20" }], ["d", { kind: "no_start", ymd: null }]]),
    },
  );
  const wk = () => null;
  it("All rows reconcile to the headline total", () => {
    expect(sumRows(out.rows)).toBe(out.totals.total);
    expect(out.unexplained).toBe(0);
  });
  it("current balance stays Due Now even when expected next week", () => {
    const a = out.rows.find((r) => r.client_id === "a")!;
    expect(matchesFilter(a, "due_now", wk)).toBe(true);
    expect(matchesFilter(a, "next_week", wk)).toBe(true);
  });
  it("renewal filters are separate", () => {
    expect(out.rows.filter((r) => matchesFilter(r, "upcoming", wk)).map((r) => r.client_id)).toEqual(["b"]);
    expect(out.rows.filter((r) => matchesFilter(r, "prepared", wk)).map((r) => r.client_id)).toEqual(["d"]);
  });
});

import { filterTotals } from "./master-dues-view";
describe("filterTotals", () => {
  const out = computeMasterDues(
    [c("a", { amount_paid: 200 }), c("b", { pending_renewal_price: 345 }), c("d", { previous_package_owed: 50, pending_renewal_price: 300 }), c("e", { pending_renewal_price: 100 })],
    {
      todayYmd: "2026-10-14",
      nextAppointmentYmd: new Map([["a", "2026-10-21"]]),
      renewalTiming: new Map([["b", { kind: "upcoming", ymd: "2026-10-16" }], ["d", { kind: "no_start", ymd: null }], ["e", { kind: "started", ymd: "2026-10-10" }]]),
    },
  );
  const weekOf = (y: string | null) => (!y ? null : y <= "2026-10-18" ? "this" : y <= "2026-10-25" ? "next" : "later") as any;
  it("all equals master total", () => expect(filterTotals(out.rows, "all", weekOf).dollars).toBe(out.totals.total));
  it("due now = previous + current + started renewals", () => expect(filterTotals(out.rows, "due_now", weekOf)).toEqual({ clients: 3, dollars: 175 + 50 + 100 }));
  it("next week counts only the current balance expected then", () => expect(filterTotals(out.rows, "next_week", weekOf)).toEqual({ clients: 1, dollars: 175 }));
  it("this week counts the renewal expected this week, not row totals", () => expect(filterTotals(out.rows, "this_week", weekOf)).toEqual({ clients: 2, dollars: 345 + 100 }));
});
