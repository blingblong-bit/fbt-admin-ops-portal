import { describe, expect, it } from "vitest";
import { buildSimpleRenewalWeek, chicagoDate, computeSimpleDues, numberSimpleVisits, shiftSimpleWeek, simpleRenewalEvents, simpleWeekStart, type SimpleBooking, type SimplePackage, type SimpleRow, type SimpleRenewalEvent } from "./simple-dues";

const now = "2026-11-24T18:00:00.000Z";
const client = { id: "a", name: "Example A", archived: false };
const pkg = (overrides: Partial<SimplePackage> = {}): SimplePackage => ({ id: "p", client_id: "a", visits: 2, price: 200, started_on: "2026-11-17", source: "opening", square_payment_id: null, flagged_for_review: false, reviewed_at: null, note: null, created_at: "2026-11-17T00:00:00Z", deleted_at: null, ...overrides });
const booking = (id: string, date: string, status = "ACCEPTED"): SimpleBooking => ({ id, clientId: "a", date, startAt: `${date}T15:00:00.000Z`, endAt: `${date}T15:45:00.000Z`, status });
const bookings = ["2026-11-17", "2026-11-19", "2026-11-23", "2026-11-25", "2026-11-27", "2026-11-29", "2026-11-30", "2026-12-02"].map((d,i) => booking(String(i),d));
const events = (): SimpleRenewalEvent[] => simpleRenewalEvents(client, [pkg()], bookings, now, "2026-11-17");
const debt = (balance: number | null, id = "a"): SimpleRow => ({ client: { ...client, id }, balance, newest: null, visitsLeft: null, next: null, unmatchedPaymentIds: [], upcomingVisits: [], renewal: null });
const week = (selectedDate = "2026-11-24", extra: Partial<Parameters<typeof buildSimpleRenewalWeek>[0]> = {}) => buildSimpleRenewalWeek({ events: events(), whoOwes: [debt(375)], selectedDate, now, ...extra });

describe("Chicago renewal week picker", () => {
  it("uses Monday through Sunday, including both boundaries", () => {
    const result = week();
    expect([result.start, result.end]).toEqual(["2026-11-23", "2026-11-29"]);
    expect(result.packages.map(r => r.visit.booking.date)).toEqual(["2026-11-23", "2026-11-27"]);
    expect(week("2026-11-30").packages.map(r => r.visit.booking.date)).toEqual(["2026-11-30"]);
  });
  it("uses Chicago current week rather than the UTC Monday", () => {
    const result = week("2026-11-29", { now: "2026-11-30T02:00:00Z" });
    expect(result.isCurrent).toBe(true);
    expect(simpleWeekStart(chicagoDate("2026-11-30T02:00:00Z"))).toBe("2026-11-23");
  });
  it("previous, next and reset dates use calendar weeks over year boundaries", () => {
    expect(shiftSimpleWeek("2026-12-28",1)).toBe("2027-01-04");
    expect(shiftSimpleWeek("2027-01-04",-1)).toBe("2026-12-28");
    expect(simpleWeekStart(chicagoDate(now))).toBe("2026-11-23");
  });
  it("does not drift across Chicago daylight-saving changes", () => {
    expect(shiftSimpleWeek("2026-03-02",1)).toBe("2026-03-09");
    expect(shiftSimpleWeek("2026-10-26",1)).toBe("2026-11-02");
  });
  it("includes every new 1/x, including multiple renewals for one client", () => {
    expect(events().map(r => r.visit.label)).toEqual(["1/2","1/2","1/2"]);
    expect(week().newPackages).toBe(400);
  });
  it("splits unpaid new packages plus already owed without changing either amount", () => {
    const result = week();
    expect([result.newPackages,result.alreadyOwed,result.total]).toEqual([400,375,775]);
    expect(result.owed[0]?.balance).toBe(375);
  });
  it("includes already owed only in the current Chicago week", () => {
    expect(week("2026-11-16").alreadyOwed).toBe(0);
    expect(week("2026-11-30").alreadyOwed).toBe(0);
    expect(week("2026-11-30").total).toBe(200);
    expect(week().alreadyOwed).toBe(375);
  });
  it("never adds zero, negative, unknown or archived balances", () => {
    const result = week(undefined,{whoOwes:[debt(0),debt(-200,"b"),debt(null,"c"),{...debt(900,"d"),client:{...client,id:"d",archived:true}},debt(50,"e")]});
    expect(result.owed.map(r=>r.client.id)).toEqual(["e"]);
    expect(result.alreadyOwed).toBe(50);
  });
  it("deduplicates booking events and owing clients", () => {
    expect(week(undefined,{events:[...events(),...events()],whoOwes:[debt(375),debt(375)]}).total).toBe(775);
  });
  it("shows paid package face value but excludes it from due", () => {
    const p=pkg({source:"auto",square_payment_id:"receipt",started_on:"2026-11-23"});
    const result=week(undefined,{events:simpleRenewalEvents(client,[p],[booking("paid","2026-11-25")],now,"2026-11-17"),whoOwes:[]});
    expect(result.packages[0]?.paid).toBe(true);
    expect([result.expectedValue,result.paidValue,result.newPackages,result.total]).toEqual([200,200,0,0]);
  });
  it("shows past expected and paid based on recorded package boundaries", () => {
    const p=pkg({source:"auto",square_payment_id:"receipt"});
    const result=week("2026-11-16",{events:simpleRenewalEvents(client,[p],bookings,now,"2026-11-17")});
    expect(result.isPast).toBe(true);
    expect([result.expectedValue,result.paidValue,result.total]).toEqual([200,200,0]);
    expect(result.owed).toEqual([]);
  });
  it("a recorded package on its 1/x date follows the existing Paid evidence rule", () => {
    const p=pkg({source:"manual",started_on:"2026-11-23"});
    expect(simpleRenewalEvents(client,[p],[booking("same-date","2026-11-23")],now,"2026-11-17")[0]?.paid).toBe(true);
  });
  it("an old receipt never pays the following projected package", () => {
    const result=simpleRenewalEvents(client,[pkg({source:"auto",square_payment_id:"old"})],bookings,now,"2026-11-17");
    expect(result.filter(r=>r.visit.cycle>0).map(r=>[r.paid,r.expected])).toEqual([[false,200],[false,200],[false,200]]);
  });
  it("does not use negative balance as renewal prepayment", () => {
    const result=week(undefined,{whoOwes:[debt(-400)]});
    expect([result.newPackages,result.alreadyOwed,result.total]).toEqual([400,0,400]);
  });
  it("uses each recorded package size and price without overlapping its successor", () => {
    const newer=pkg({id:"new",source:"auto",square_payment_id:"new-payment",started_on:"2026-11-27",visits:4,price:375});
    const result=simpleRenewalEvents(client,[pkg(),newer],bookings,now,"2026-11-17");
    expect(result.map(r=>[r.visit.booking.date,r.visit.size,r.visit.price,r.paid])).toEqual([["2026-11-23",2,200,false],["2026-11-27",4,375,true]]);
  });
  it("skips cancelled visits and does not shift to a cancelled 1/x date", () => {
    const result=simpleRenewalEvents(client,[pkg()],[...bookings,booking("cancelled","2026-11-22","CANCELLED_BY_SELLER")],now,"2026-11-17");
    expect(result.map(r=>r.visit.booking.date)).toEqual(events().map(r=>r.visit.booking.date));
  });
  it("removed, other-client and archived packages never add expected money", () => {
    expect(simpleRenewalEvents(client,[pkg({deleted_at:now}),pkg({client_id:"b"})],bookings,now,"2026-11-17")).toEqual([]);
    expect(simpleRenewalEvents({...client,archived:true},[pkg()],bookings,now,"2026-11-17")).toEqual([]);
  });
  it("incomplete appointments withhold the package total, retaining known debt rows", () => {
    const result=week(undefined,{bookingsReliable:false});
    expect(result.packages).toEqual([]);
    expect(result.appointmentsReliable).toBe(false);
    expect(result.alreadyOwed).toBe(375);
  });
  it("sums currency in cents", () => {
    const list=events().slice(0,2).map((r,i)=>({...r,expected:i===0?0.1:0.2}));
    expect(week(undefined,{events:list,whoOwes:[debt(0.1)]}).total).toBe(0.4);
  });
  it("does not mutate inputs or alter simple balance calculations", () => {
    const input={clients:[client],packages:[pkg()],payments:[],bookings,openings:[{client_id:"a",amount:375}],priceList:[],cutoverDate:"2026-11-17",now};
    const snapshot=JSON.stringify(input);
    const result=computeSimpleDues(input);
    const originalRows=JSON.stringify(result.rows);
    const selected=buildSimpleRenewalWeek({events:result.renewalEvents,whoOwes:result.whoOwes,selectedDate:"2026-11-30",now});
    expect([result.totalOwed,result.owingCount,result.rows[0]?.balance]).toEqual([375,1,375]);
    expect(selected.total).toBe(200);
    expect(JSON.stringify(result.rows)).toBe(originalRows);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(numberSimpleVisits(pkg(),bookings,now).map(v=>v.label)).toEqual(["1/2","2/2","1/2","2/2","1/2","2/2","1/2","2/2"]);
  });
});