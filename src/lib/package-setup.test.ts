import { describe, expect, it } from "vitest";
import { classifySetup, sortSetupRows, type SetupClient } from "./package-setup";
import { applyOverrides } from "./package-override";

const now = "2026-10-24T16:00:00Z";
const c = (p: Partial<SetupClient> = {}): SetupClient => ({ id: "a", status: "assessment", payment_model: "package", package_total_visits: 0, ...p });
const past = { start_at: "2026-10-20T15:00:00Z", status: "ACCEPTED" };
const fut = { start_at: "2026-10-27T15:00:00Z", status: "ACCEPTED" };

describe("Needs Package Setup", () => {
  it("assessment done, nothing booked → follow-up, still listed", () => {
    expect(classifySetup(c(), false, [past], now)?.state).toBe("follow_up");
    expect(classifySetup(c(), false, [], now)?.reason).toBe("No Square visit history");
  });
  it("future booking after a past visit without a package → urgent", () => {
    const r = classifySetup(c(), true, [past, fut], now)!;
    expect([r.state, r.next_appointment_ymd, r.last_visit_ymd]).toEqual(["urgent", "2026-10-27", "2026-10-20"]);
  });
  it("assessment-only booking is not a missing package", () => {
    expect(classifySetup(c(), false, [fut], now)?.state).toBe("assessment_scheduled");
    expect(classifySetup(c(), false, [past, { ...fut, seller_note: "Assessment" }], now)?.state).toBe("assessment_scheduled");
  });
  it("cancelled future booking does not count", () => {
    expect(classifySetup(c(), false, [past, { ...fut, status: "CANCELLED_BY_CUSTOMER" }], now)?.state).toBe("follow_up");
  });
  it("leaves the list once a package is assigned", () => {
    expect(classifySetup(c({ package_total_visits: 8 }), true, [past, fut], now)).toBeNull();
  });
  it("admin override with a package removes it", () => {
    const eff = applyOverrides(c(), [{ slot: "current", total_visits: 8, visits_used: 1, price: 375, recognized_paid: 0, start_date: "2026-10-20", status: "active" }]);
    expect(classifySetup(eff, false, [past, fut], now)).toBeNull();
  });
  it("dismissed active clients stay in follow-up; plain active, pay-per-visit and archived do not", () => {
    expect(classifySetup(c({ status: "active" }), true, [past], now)).not.toBeNull();
    expect(classifySetup(c({ status: "active" }), false, [past], now)).toBeNull();
    expect(classifySetup(c({ payment_model: "pay_per_visit" }), true, [past], now)).toBeNull();
    expect(classifySetup(c({ status: "archived" }), true, [past], now)).toBeNull();
  });
  it("no duplicates; urgent sorted first", () => {
    const f = classifySetup(c({ id: "f" }), false, [past], now)!;
    const u = classifySetup(c({ id: "u" }), false, [past, fut], now)!;
    expect(sortSetupRows([f, u, u]).map((r) => r.client_id)).toEqual(["u", "f"]);
  });
});
