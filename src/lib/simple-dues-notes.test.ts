import { describe, expect, it } from "vitest";
import { assignSimplePackages, buildSimpleRenewalWeek, computeSimpleDues, numberSimpleVisits, simpleRenewalEvents, type SimpleBooking, type SimplePackage } from "./simple-dues";
import { simpleCurrentPackage } from "./simple-dues-view";

const now = "2026-11-24T05:57:00.000Z";
const client = { id: "example", name: "Example Client", archived: false };
const opening: SimplePackage = { id: "opening", client_id: client.id, visits: 8, price: 375, started_on: "2026-08-14", created_at: "2026-11-24T00:00:00Z", source: "opening", square_payment_id: null, flagged_for_review: false, reviewed_at: null, note: null, deleted_at: null };
const b = (id: string, date: string, sellerNote: string | null = null, extra: Partial<SimpleBooking> = {}): SimpleBooking => ({ id, clientId: client.id, date, startAt: `${date}T15:00:00.000Z`, endAt: `${date}T15:45:00.000Z`, status: "ACCEPTED", sellerNote, ...extra });
const bookings = [b("old", "2026-09-01"), b("last", "2026-11-23", "7 of 8"), b("next", "2026-11-25"), b("renewal", "2026-11-30")];
const board = (appts = bookings, packages = [opening], clock = now) => computeSimpleDues({ clients: [client], packages, bookings: appts, now: clock, cutoverDate: "2026-11-24", payments: [], openings: [], priceList: [] });

describe("authoritative Square-note simple visit numbering", () => {
  it("stale August start does not turn next 8/8 into projected 2/8 or $375 owed", () => {
    const result = board();
    expect(result.rows[0]?.upcomingVisits.map(v => v.label)).toEqual(["8/8", "1/8"]);
    expect(result.rows[0]?.visitsLeft).toBe(1);
    expect(result.totalOwed).toBe(0);
    expect(result.upcomingRenewals[0]?.visit.booking.id).toBe("renewal");
    expect(simpleCurrentPackage([opening], bookings, now, true).visitsLeft).toBe(1);
    expect(simpleCurrentPackage([opening], bookings, now, true).nextStart?.booking.id).toBe("renewal");
    const week = buildSimpleRenewalWeek({ events: result.renewalEvents, whoOwes: result.whoOwes, selectedDate: "2026-11-25", now });
    expect(week.carriedOver).toBe(0);
    expect(week.total).toBe(0);
  });
  it("a latest upcoming 8/8 note anchors backwards even with stale earlier notes", () => {
    expect(numberSimpleVisits(opening, [b("old", "2026-11-20", "3/8"), b("last", "2026-11-23"), b("next", "2026-11-25", "8/8"), b("new", "2026-11-30")], now).map(v => v.label)).toEqual(["3/8", "7/8", "8/8", "1/8"]);
  });
  it("explicit 1 of 8 mid-stream restarts the package and does not reuse an old record", () => {
    const result = board([b("last", "2026-11-23", "4/8"), b("reset", "2026-11-25", "1 of 8"), b("next", "2026-11-27")]);
    expect(result.rows[0]?.upcomingVisits.map(v => [v.label, v.newPackage])).toEqual([["1/8", true], ["2/8", false]]);
    expect(result.renewalEvents[0]).toMatchObject({ paid: false, expected: 375 });
  });
  it("reuses the parser's customer-note fallback and does not parse dates as visit numbers", () => {
    const result = assignSimplePackages([opening], [b("past", "2026-11-23", "11/23/26", { customerNote: "visit #7 of 8" }), b("next", "2026-11-25")], now);
    expect(result.visits.map(v => v.label)).toEqual(["7/8", "8/8"]);
  });
  it("no parseable notes falls back to the newest package start", () => {
    const newest = { ...opening, id: "newest", started_on: "2026-11-23", created_at: now };
    const result = assignSimplePackages([opening, newest], bookings.map(v => ({ ...v, sellerNote: null })), now);
    expect(result.visits.map(v => [v.booking.id, v.label])).toEqual([["last", "1/8"], ["next", "2/8"], ["renewal", "3/8"]]);
    expect(result.visitsLeft).toBe(7);
  });
  it("future cancelled numbered bookings never advance labels or create a renewal", () => {
    const result = board([bookings[1] ?? b("last", "2026-11-23", "7/8"), b("cancel", "2026-11-25", "1 of 8", { status: "CANCELLED_BY_SELLER" }), b("next", "2026-11-27")]);
    expect(result.rows[0]?.upcomingVisits.map(v => v.label)).toEqual(["8/8"]);
    expect(result.upcomingRenewals).toEqual([]);
  });
  it("future opener is expected only; after its start it becomes carried-over and Renew soon", () => {
    const appts = [b("last", "2026-11-23", "8/8"), b("new", "2026-11-25", "1/8")];
    const before = board(appts);
    const after = board(appts, [opening], "2026-11-25T15:01:00.000Z");
    expect(before.upcomingRenewals[0]?.expected).toBe(375);
    expect(buildSimpleRenewalWeek({ events: before.renewalEvents, whoOwes: [], selectedDate: "2026-12-07", now }).carriedOver).toBe(0);
    expect(buildSimpleRenewalWeek({ events: after.renewalEvents, whoOwes: [], selectedDate: "2026-11-25", now: "2026-11-25T15:01:00.000Z" }).carriedOver).toBe(375);
    expect(after.renewSoon.map(r => r.client.id)).toEqual([client.id]);
    expect(after.totalOwed).toBe(0); // simpleBalance is deliberately unchanged
  });
  it.each(["auto", "manual"] as const)("a recorded %s package covers the next boundary once", source => {
    const next = { ...opening, id: "paid-next", source, price: 375, started_on: "2026-11-24", created_at: now, square_payment_id: source === "auto" ? "receipt" : null };
    const appts = [b("last", "2026-11-23", "8 of 8"), b("next", "2026-11-25", "1 of 8"), ...Array.from({ length: 8 }, (_, i) => b(`later-${i}`, `2026-12-${String(i + 1).padStart(2, "0")}`))];
    const events = simpleRenewalEvents(client, [opening, next], appts, now, "2026-11-24");
    expect(events.map(e => [e.paid, e.expected])).toEqual([[true, 0], [false, 375]]);
  });
  it("projections do not mutate records or use negative balances as general credit", () => {
    const snapshot = JSON.stringify(bookings);
    const input = { clients: [client], packages: [opening], bookings, now, cutoverDate: "2026-11-24", payments: [], openings: [{ client_id: client.id, amount: -375 }], priceList: [] };
    const result = computeSimpleDues(input);
    expect(result.rows[0]?.balance).toBe(-375);
    expect(result.upcomingRenewals[0]?.expected).toBe(375);
    expect(JSON.stringify(bookings)).toBe(snapshot);
  });
  it("an unrecorded explicit restart enters Renew soon immediately, even while running", () => {
    const result = board([b("last", "2026-11-23", "4/8"), b("new", "2026-11-25", "1/8")], [opening], "2026-11-25T15:01:00.000Z");
    expect(result.renewSoon.map(r => r.client.id)).toEqual([client.id]);
    expect(result.rows[0]?.visitsLeft).toBe(4);
  });
  it("a no-note projected opener becomes carried-over at its start, not at its end", () => {
    const pkg = {...opening,visits:1,started_on:"2026-11-23"};
    const result = board([b("past", "2026-11-23"), b("new", "2026-11-25")], [pkg], "2026-11-25T15:01:00.000Z");
    expect(buildSimpleRenewalWeek({events:result.renewalEvents,whoOwes:[],selectedDate:"2026-11-25",now:"2026-11-25T15:01:00.000Z"}).carriedOver).toBe(375);
    expect(result.rows[0]?.visitsLeft).toBe(0);
  });
  it("an isolated future numbered note gives visits left from its number, not stale dates", () => {
    expect(assignSimplePackages([opening], [b("next", "2026-11-25", "8 of 8")], now).visitsLeft).toBe(1);
  });
  it("profile progress uses the note's denominator without rewriting package size or price", () => {
    const pkg = {...opening,visits:4,price:1};
    const summary = simpleCurrentPackage([pkg], bookings.slice(1,3), now, true);
    expect([summary.visitsLeft,summary.totalVisits]).toEqual([1,8]);
    expect([summary.package?.visits,summary.package?.price]).toEqual([4,1]);
  });
});