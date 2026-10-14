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
