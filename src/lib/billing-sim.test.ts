import { describe, expect, it } from "vitest";
import { projectMasterDues, simulateBilling, type SimAppointment, type SimPayment } from "./billing-sim";

const today = "2026-10-14"; // Wed; work week starts 10-12
const now = "2026-10-14T17:00:00Z";
const ap = (id: string, ymd: string, hour = 15, status = "ACCEPTED"): SimAppointment => ({ id, ymd, start_iso: `${ymd}T${String(hour).padStart(2, "0")}:00:00Z`, status });
const pay = (id: string, at: string, amount: number): SimPayment => ({ id, at_iso: at, amount });
const ppv = (appointments: SimAppointment[], payments: SimPayment[] = []) =>
  simulateBilling({ type: "pay_per_visit", rate: 40, appointments, payments, todayYmd: today, nowIso: now });
const weekly = (appointments: SimAppointment[], payments: SimPayment[] = []) =>
  simulateBilling({ type: "weekly", rate: 80, appointments, payments, todayYmd: today, nowIso: now });
const ok = (r: ReturnType<typeof simulateBilling>) => { if (r.setup !== "ok") throw new Error("setup"); return r; };

describe("billing simulator", () => {
  it("1. PPV before start = Upcoming", () => {
    expect(ok(ppv([ap("a", "2026-10-15")])).obligations[0]).toMatchObject({ status: "upcoming", open: 40 });
  });
  it("2. PPV after start = Due Now", () => {
    expect(ok(ppv([ap("a", "2026-10-14", 14)])).obligations[0].status).toBe("due_now");
  });
  it("3. paid PPV visit = $0 open", () => {
    const r = ok(ppv([ap("a", "2026-10-13")], [pay("p", "2026-10-13T16:00:00Z", 40)]));
    expect(r.open).toBe(0);
    expect(r.obligations[0].status).toBe("paid");
  });
  it("4. two PPV visits, first unpaid → Due Now + Upcoming", () => {
    const r = ok(ppv([ap("a", "2026-10-12"), ap("b", "2026-10-15")]));
    expect(r.obligations.map((o) => o.status)).toEqual(["due_now", "upcoming"]);
    expect(r.open).toBe(80);
  });
  it("5. cancelled PPV = $0", () => {
    const r = ok(ppv([ap("a", "2026-10-13", 15, "CANCELLED_BY_CUSTOMER")]));
    expect(r.open).toBe(0);
    expect(r.info[0].kind).toBe("cancelled");
  });
  it("6. PPV beyond next week is excluded", () => {
    const r = ok(ppv([ap("a", "2026-10-27")]));
    expect(r.open).toBe(0);
    expect(r.info[0].kind).toBe("beyond_horizon");
  });
  it("7. weekly client with 3 visits = one charge", () => {
    const r = ok(weekly([ap("a", "2026-10-12"), ap("b", "2026-10-13"), ap("c", "2026-10-15")]));
    expect(r.obligations).toHaveLength(1);
    expect(r.open).toBe(80);
  });
  it("8. weekly charge paid = $0", () => {
    expect(ok(weekly([ap("a", "2026-10-12")], [pay("p", "2026-10-12T16:00:00Z", 80)])).open).toBe(0);
  });
  it("9. prior unpaid week + current week = two obligations, $160 Due Now", () => {
    const r = ok(weekly([ap("a", "2026-10-06"), ap("b", "2026-10-13")]));
    expect(r.obligations.map((o) => o.status)).toEqual(["due_now", "due_now"]);
    expect(r.open).toBe(160);
  });
  it("10. payment applies to oldest obligation first", () => {
    const r = ok(ppv([ap("a", "2026-10-06"), ap("b", "2026-10-13")], [pay("p", "2026-10-13T18:00:00Z", 40)]));
    expect(r.obligations.map((o) => o.open)).toEqual([0, 40]);
  });
  it("11. overpayment is reported, not credit", () => {
    const r = ok(ppv([ap("a", "2026-10-13")], [pay("p", "2026-10-13T18:00:00Z", 120)]));
    expect(r.open).toBe(0);
    expect(r.payments).toEqual([expect.objectContaining({ kind: "overpayment", amount: 80 })]);
  });
  it("12. unclear rate/model = needs billing setup, no dollars", () => {
    const r = simulateBilling({ type: "pay_per_visit", rate: null, appointments: [ap("a", "2026-10-13")], payments: [], todayYmd: today, nowIso: now });
    expect(r).toMatchObject({ setup: "needs_billing_setup", open: 0 });
  });
  it("13. replacement does not double-count package Master Dues", () => {
    const p = projectMasterDues(10750, [{ replaced: 375, simulatedOpen: 80 }, { replaced: 0, simulatedOpen: 40 }]);
    expect(p).toMatchObject({ replaced: 375, added: 120, projected: 10495, difference: 0 });
  });
  it("unclear payment amount marks earlier open obligations for billing review", () => {
    const r = ok(weekly([ap("a", "2026-10-06")], [pay("p", "2026-10-07T14:00:00Z", 53.34)]));
    expect(r.obligations[0].status).toBe("needs_billing_review");
    expect(r.open).toBe(0);
    expect(r.payments[0].kind).toBe("unclear");
  });
  it("missing payment records send past weeks to billing review, current week still counts", () => {
    const r = ok(simulateBilling({ type: "pay_per_visit", rate: 40, appointments: [ap("a", "2026-10-07"), ap("b", "2026-10-15")], payments: [], todayYmd: today, nowIso: now, paymentRecordsMissing: true }));
    expect(r.obligations.map((o) => o.status)).toEqual(["needs_billing_review", "upcoming"]);
    expect(r.open).toBe(40);
    expect(r.reviewOpen).toBe(40);
  });
});
