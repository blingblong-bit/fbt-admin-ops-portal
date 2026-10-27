import { describe, it, expect } from "vitest";
import { handleLinkPayment, type LinkDb } from "./payment-link-handler";
import { fixtureObligation } from "./payment-link.functions";
import { decideLink } from "./payment-link";

function fakeDb(links: any[], clients: any[], withLedger: boolean) {
  const credits: any[] = []; const ledger = new Map<string, any>(); const applied = new Set<string>();
  const db: LinkDb = {
    async findLink(env, orderId) { return links.find((l) => l.square_order_id === orderId && l.environment === env) ?? null; },
    async getClient(id) { return clients.find((c) => c.id === id) ?? null; },
    async apply(clientId, paymentId, cents) {
      if (applied.has(paymentId)) return { credited: false };
      applied.add(paymentId); credits.push({ clientId, paymentId, cents }); return { credited: true };
    },
    async updateLink(id, patch) { Object.assign(links.find((l) => l.id === id), patch); },
  };
  if (withLedger) db.recordPayment = async (r) => { ledger.set(r.paymentId, r); };
  return { db, credits, ledger, links };
}
const link = (o: any = {}) => ({ id: "L1", client_id: "fx", amount_cents: 27500, status: "active", square_payment_id: null, environment: "sandbox", square_order_id: "O1", ...o });
const fx = { id: "fx", is_test_fixture: true }, real = { id: "real", is_test_fixture: false };
const pay = (o: any = {}) => ({ orderId: "O1", paymentId: "P1", amountCents: 27500, status: "COMPLETED", ...o });

describe("checkout-link payment handler", () => {
  it("credits fixture once; repeat event credits nothing; link stays paid", async () => {
    const t = fakeDb([link()], [fx], false);
    expect((await handleLinkPayment(t.db, "sandbox", pay())).kind).toBe("apply");
    const r2 = await handleLinkPayment(t.db, "sandbox", pay());
    expect(r2.kind).toBe("replay"); expect(r2.credited).toBe(false);
    expect(t.credits).toEqual([{ clientId: "fx", paymentId: "P1", cents: 27500 }]);
    expect(t.links[0].status).toBe("paid");
  });
  it("sandbox never credits a real client even if the mapping points at one", async () => {
    const t = fakeDb([link({ client_id: "real" })], [real], false);
    const r = await handleLinkPayment(t.db, "sandbox", pay());
    expect(r).toEqual({ kind: "hold", reason: "sandbox_non_fixture" }); expect(t.credits).toEqual([]);
  });
  it("production webhook never sees sandbox link rows", async () => {
    const t = fakeDb([link()], [fx], true);
    expect((await handleLinkPayment(t.db, "production", pay())).kind).toBe("not_link");
    expect(t.credits).toEqual([]); expect(t.ledger.size).toBe(0);
  });
  it("production refuses fixture clients", async () => {
    const t = fakeDb([link({ environment: "production" })], [fx], true);
    expect(await handleLinkPayment(t.db, "production", pay())).toEqual({ kind: "hold", reason: "fixture_in_production" });
  });
  it.each([
    ["amount mismatch", link(), pay({ amountCents: 20000 }), "amount_differs_from_link"],
    ["retired link", link({ status: "superseded" }), pay(), "paid_stale_link"],
    ["second payment", link({ status: "paid", square_payment_id: "P0" }), pay(), "second_payment_on_link"],
  ])("%s: money kept, flagged, not credited, and review sticks on replay", async (_n, l, p, reason) => {
    const t = fakeDb([{ ...l, environment: "production" }], [{ id: "fx", is_test_fixture: false }], true);
    expect(await handleLinkPayment(t.db, "production", p)).toEqual({ kind: "hold", reason });
    expect(t.credits).toEqual([]);
    expect(t.ledger.get("P1")).toMatchObject({ applied: false, needsReview: true, cents: p.amountCents });
    const again = await handleLinkPayment(t.db, "production", p);
    expect(again.kind).toBe("hold"); expect(t.credits).toEqual([]);
    expect(t.ledger.get("P1").needsReview).toBe(true);
  });
  it("pending status is recorded but not credited", async () => {
    const t = fakeDb([link()], [fx], false);
    expect((await handleLinkPayment(t.db, "sandbox", pay({ status: "APPROVED" }))).kind).toBe("record_only");
    expect(t.credits).toEqual([]); expect(t.links[0].status).toBe("active");
  });
});

describe("fixture obligation uses effective (override) figures", () => {
  const base = { id: "fx", status: "active", package_price: 375, amount_paid: 375, package_total_visits: 8, visits_used: 7, package_start_date: "2026-10-06",
    pending_renewal_price: 375, pending_renewal_paid: 750, pending_renewal_total_visits: 8, pending_renewal_start_date: "2026-10-08" };
  const pend = { client_id: "fx", slot: "pending", total_visits: 8, visits_used: null, price: 375, recognized_paid: 0, start_date: "2026-10-29", status: "active" };
  it("Leann-style raw Oct 8/$750 → effective Oct 29/$0 owes $375 with Oct 29 in key", () => {
    const { ob, eff } = fixtureObligation(base, [pend], "2026-10-27");
    expect(eff.pending_renewal_start_date).toBe("2026-10-29");
    expect(ob).toMatchObject({ ok: true, amountCents: 37500 });
    expect((ob as any).obligationKey).toContain("prep:2026-10-29");
  });
  it("without override raw $750 paid means nothing owed (proves override is applied)", () => {
    expect(fixtureObligation(base, [], "2026-10-27").ob.ok).toBe(false);
  });
  it("partial prepaid 375-100 → $275; other-channel payment changes key → old link superseded", () => {
    const a = fixtureObligation(base, [{ ...pend, recognized_paid: 100 }], "2026-10-27").ob as any;
    expect(a.amountCents).toBe(27500);
    const b = fixtureObligation(base, [{ ...pend, recognized_paid: 200 }], "2026-10-27").ob as any;
    expect(decideLink({ id: "L1", obligation_key: a.obligationKey, status: "active", url: "u" }, b)).toEqual({ action: "create", supersede: "L1" });
  });
  it("new debt on the current package changes key too", () => {
    const a = fixtureObligation(base, [pend], "2026-10-27").ob as any;
    const b = fixtureObligation({ ...base, amount_paid: 300 }, [pend], "2026-10-27").ob as any;
    expect(b.amountCents).toBe(45000); expect(b.obligationKey).not.toBe(a.obligationKey);
  });
});
