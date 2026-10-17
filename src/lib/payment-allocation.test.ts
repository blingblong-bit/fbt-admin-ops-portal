import { describe, expect, it } from "vitest";
import { currentSplit, originalFromMetadata, paymentStatus, planMove, sameAmountWarnings, splitTotal, type Activity, type LedgerRow } from "./payment-allocation";

const client = { previous_package_owed: 100, amount_paid: 200, pending_renewal_paid: 0, pending_renewal_start_date: "2026-11-01" };
const pay = (meta: Record<string, unknown>, at = "2026-10-10T12:00:00Z"): Activity => ({ id: "p", activity_type: "payment", created_at: at, metadata: { square_payment_id: "PAY1", ...meta } });
const meta345 = { amount: 345, applied_to_previous_package: 0, applied_to_current_package: 345, applied_to_pending_package: 0 };

describe("payment allocation", () => {
  it("moves keep the payment total the same", () => {
    const s = { previous: 0, current: 345, pending: 0 };
    const p = planMove(s, { ...client, amount_paid: 690 }, "current", "pending", 345);
    expect(p.ok && splitTotal(p.split)).toBe(345);
    expect(p.ok && p.client).toEqual({ previous_package_owed: 100, amount_paid: 345, pending_renewal_paid: 345 });
  });

  it("the same dollars can't be moved twice", () => {
    const s = { previous: 0, current: 200, pending: 0 };
    const first = planMove(s, client, "current", "pending", 200);
    expect(first.ok).toBe(true);
    const again = planMove(first.ok ? first.split : s, first.ok ? { ...client, ...first.client } : client, "current", "pending", 200);
    expect(again.ok).toBe(false);
  });

  it("moving onto previous debt pays it down; moving off makes it owed again", () => {
    const on = planMove({ previous: 0, current: 200, pending: 0 }, client, "current", "previous", 60);
    expect(on.ok && on.client.previous_package_owed).toBe(40);
    expect(on.ok && on.client.amount_paid).toBe(140);
    const off = planMove({ previous: 50, current: 150, pending: 0 }, client, "previous", "current", 50);
    expect(off.ok && off.client.previous_package_owed).toBe(150);
    expect(off.ok && off.client.amount_paid).toBe(250);
  });

  it("cannot pay previous debt below $0", () => {
    expect(planMove({ previous: 0, current: 200, pending: 0 }, client, "current", "previous", 150).ok).toBe(false);
  });

  it("cannot move to a prepared renewal that doesn't exist", () => {
    expect(planMove({ previous: 0, current: 200, pending: 0 }, { ...client, pending_renewal_start_date: null }, "current", "pending", 50).ok).toBe(false);
  });

  it("current split = original + transfers and reconciles to the payment", () => {
    const rows: LedgerRow[] = [
      { kind: "original", bucket: "previous", amount: 0 },
      { kind: "original", bucket: "current", amount: 345 },
      { kind: "original", bucket: "pending", amount: 0 },
      { kind: "transfer", bucket: "current", amount: -100 },
      { kind: "transfer", bucket: "pending", amount: 100 },
      { kind: "transfer", bucket: "current", amount: -45 },
      { kind: "transfer", bucket: "previous", amount: 45 },
    ];
    const s = currentSplit(rows);
    expect(s).toEqual({ previous: 45, current: 200, pending: 100 });
    expect(splitTotal(s)).toBe(345);
    expect(paymentStatus(pay(meta345), [pay(meta345)], rows).movable).toBe(true);
  });

  it("payments with no recorded original split are Needs Review and can't move", () => {
    expect(originalFromMetadata({ amount: 200 })).toBeNull();
    const st = paymentStatus(pay({ amount: 200 }), [], []);
    expect(st.movable).toBe(false);
    expect(st.reason).toMatch(/Needs Review/);
  });

  it("a split that doesn't add up is rejected", () => {
    expect(originalFromMetadata({ amount: 200, applied_to_previous_package: 0, applied_to_current_package: 150, applied_to_pending_package: 0 })).toBeNull();
  });

  it("a renewal or money edit after the payment blocks moving it", () => {
    const p = pay(meta345);
    const renewal: Activity = { id: "r", activity_type: "renewal", created_at: "2026-10-12T00:00:00Z", metadata: {} };
    expect(paymentStatus(p, [p, renewal], []).movable).toBe(false);
    const nonMoneyEdit: Activity = { id: "e", activity_type: "edit", created_at: "2026-10-12T00:00:00Z", metadata: { money_changed: false } };
    expect(paymentStatus(p, [p, nonMoneyEdit], []).movable).toBe(true);
    const oldEdit: Activity = { id: "e2", activity_type: "edit", created_at: "2026-10-12T00:00:00Z", metadata: null };
    expect(paymentStatus(p, [p, oldEdit], []).movable).toBe(false);
  });

  it("same amount within 3 days warns; 4 days later does not", () => {
    const prior = [{ ref: "A", amount: 175, at: "2026-10-14T12:00:00Z" }];
    expect(sameAmountWarnings(prior, 175, "2026-10-16T12:00:00Z")).toHaveLength(1);
    expect(sameAmountWarnings(prior, 175, "2026-10-18T13:00:00Z")).toHaveLength(0);
    expect(sameAmountWarnings(prior, 200, "2026-10-16T12:00:00Z")).toHaveLength(0);
  });
});
