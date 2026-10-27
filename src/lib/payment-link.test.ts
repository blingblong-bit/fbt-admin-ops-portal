import { describe, it, expect } from "vitest";
import { obligationFor, decideLink, idempotencyKeyFor, planLinkPayment } from "./payment-link";

const row = (o: any = {}) => ({
  client_id: "c1", name: "T",
  previous: { amount: 0, status: "none" }, current: { amount: 0, status: "none", expected: null },
  renewal: { amount: 375, status: "prepared", expected_ymd: "2026-10-29" },
  billing: { type: null, amount: 0, due_now: 0, carryover: 0, this_week: 0, next_week: 0, obligations: [] },
  total: 375, reasons: [], ...o,
}) as any;
const b = { currentStart: "2026-10-06", preparedStart: "2026-10-29" };

describe("payment link obligation", () => {
  it("uses effective total $375", () => {
    const o = obligationFor(row(), b);
    expect(o.ok && o.amountCents).toBe(37500);
  });
  it("partial prepaid 375-100 = $275", () => {
    const o = obligationFor(row({ renewal: { amount: 275, status: "prepared", expected_ymd: null }, total: 275 }), b);
    expect(o.ok && o.amountCents).toBe(27500);
  });
  it("refuses paid, review and billing clients", () => {
    expect(obligationFor(row({ total: 0 }), b)).toEqual({ ok: false, reason: "already_paid" });
    expect(obligationFor(row({ current: { amount: 0, status: "needs_review", expected: null } }), b).ok).toBe(false);
    expect(obligationFor(row({ billing: { type: "weekly" } }), b).ok).toBe(false);
  });
  it("repeat generation reuses; changed amount supersedes", () => {
    const o = obligationFor(row(), b) as any;
    const active = { id: "L1", obligation_key: o.obligationKey, status: "active", url: "u" };
    expect(decideLink(active, o).action).toBe("reuse");
    const o2 = obligationFor(row({ total: 275 }), b) as any;
    expect(decideLink(active, o2)).toEqual({ action: "create", supersede: "L1" });
    expect(idempotencyKeyFor(o.obligationKey, "sandbox")).toBe(idempotencyKeyFor(o.obligationKey, "sandbox"));
  });
  it("matching payment applies to link client", () => {
    const l = { id: "L1", client_id: "c1", amount_cents: 37500, status: "active", square_payment_id: null, environment: "sandbox" };
    expect(planLinkPayment({ env: "sandbox", link: l, client: { id: "c1", is_test_fixture: true }, paymentId: "p1", amountCents: 37500, status: "COMPLETED" })).toEqual({ kind: "apply", clientId: "c1" });
    expect(planLinkPayment({ env: "sandbox", link: l, client: { id: "other", is_test_fixture: true }, paymentId: "p1", amountCents: 37500, status: "COMPLETED" }).kind).toBe("hold");
  });
});
