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
    expect(week().newThisWeek).toBe(400);
  });
  it("splits current carried balance and new packages without changing either amount", () => {
    const result = week();
    expect([result.newThisWeek,result.carriedOver,result.total]).toEqual([400,375,775]);
    expect(result.rows[0]).toMatchObject({carriedOver:375,newThisWeek:400,total:775});
  });
  it("carries current debt plus intervening upcoming starts into future weeks, never past weeks", () => {
    expect(week("2026-11-16").carriedOver).toBe(0);
    expect(week("2026-11-30").carriedOver).toBe(575);
    expect(week("2026-11-30").total).toBe(775);
    expect(week().carriedOver).toBe(375);
  });
  it("never adds zero, negative, unknown or archived balances", () => {
    const result = week(undefined,{whoOwes:[debt(0),debt(-200,"b"),debt(null,"c"),{...debt(900,"d"),client:{...client,id:"d",archived:true}},debt(50,"e")]});
    expect(result.rows.filter(r=>r.carriedOver>0).map(r=>r.client.id)).toEqual(["e"]);
    expect(result.carriedOver).toBe(50);
  });
  it("deduplicates booking events and owing clients", () => {
    expect(week(undefined,{events:[...events(),...events()],whoOwes:[debt(375),debt(375)]}).total).toBe(775);
  });
  it("shows paid package face value but excludes it from due", () => {
    const p=pkg({source:"auto",square_payment_id:"receipt",started_on:"2026-11-23"});
    const result=week(undefined,{events:simpleRenewalEvents(client,[p],[booking("paid","2026-11-25")],now,"2026-11-17"),whoOwes:[]});
    expect(result.packages[0]?.paid).toBe(true);
    expect([result.expectedValue,result.paidValue,result.newThisWeek,result.total]).toEqual([200,200,0,0]);
  });
  it("shows past expected and paid based on recorded package boundaries", () => {
    const p=pkg({source:"auto",square_payment_id:"receipt"});
    const result=week("2026-11-16",{events:simpleRenewalEvents(client,[p],bookings,now,"2026-11-17")});
    expect(result.isPast).toBe(true);
    expect([result.expectedValue,result.paidValue,result.total]).toEqual([200,200,0]);
    expect(result.rows.map(r=>r.carriedOver)).toEqual([0]);
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
    expect([result.newThisWeek,result.carriedOver,result.total]).toEqual([400,0,400]);
  });
  it("uses each recorded package size and price without overlapping its successor", () => {
    const newer=pkg({id:"new",source:"auto",square_payment_id:"new-payment",started_on:"2026-11-27",visits:4,price:375});
    const result=simpleRenewalEvents(client,[pkg(),newer],bookings,now,"2026-11-17");
    expect(result.map(r=>[r.visit.booking.date,r.visit.size,r.visit.price,r.paid])).toEqual([["2026-11-23",4,375,true],["2026-11-30",4,375,false]]);
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
    expect(result.carriedOver).toBe(375);
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
    expect(selected.total).toBe(775);
    expect(JSON.stringify(result.rows)).toBe(originalRows);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(numberSimpleVisits(pkg(),bookings,now).map(v=>v.label)).toEqual(["1/2","2/2","1/2","2/2","1/2","2/2","1/2","2/2"]);
  });
});

describe("read-only per-client carried-over projection", () => {
  const event=(id:string,date:string,paid=false,price=375):SimpleRenewalEvent=>({client,packageId:"p",paid,expected:paid?0:price,visit:{booking:booking(id,date),number:1,size:8,label:"1/8",cycle:1,newPackage:true,price}});
  it("$375 owed now plus a next-week 1/8 shows carried $375 + new $375 = $750",()=>{
    const result=week("2026-11-30",{events:[event("next","2026-12-01")]});
    expect([result.carriedOver,result.newThisWeek,result.total]).toEqual([375,375,750]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({carriedOver:375,newThisWeek:375,total:750});
  });
  it("also carries an unpaid upcoming start from the current week into next week",()=>{
    const result=week("2026-11-30",{events:[event("this","2026-11-27"),event("next","2026-12-01")]});
    expect([result.carriedOver,result.newThisWeek,result.total]).toEqual([750,375,1125]);
    expect(result.rows[0]?.carriedPackages.map(r=>r.visit.booking.id)).toEqual(["this"]);
  });
  it("carries every intervening unpaid week, but not packages after the selected week",()=>{
    const result=week("2026-12-07",{events:[event("current","2026-11-27"),event("next","2026-12-01"),event("selected","2026-12-09"),event("later","2026-12-16")]});
    expect([result.carriedOver,result.newThisWeek,result.total]).toEqual([1125,375,1500]);
  });
  it("does not add past-week or already-past current-week starts to future carried debt",()=>{
    const result=week("2026-11-30",{events:[event("old","2026-11-20"),event("past-today","2026-11-24"),event("upcoming","2026-11-27")]});
    expect(result.carriedOver).toBe(750);
    expect(result.rows[0]?.carriedPackages.map(r=>r.visit.booking.id)).toEqual(["upcoming"]);
  });
  it("paid starts add zero both in their own week and in future carry-over",()=>{
    const events=[event("paid-current","2026-11-27",true),event("paid-next","2026-12-01",true)];
    const next=week("2026-11-30",{events});
    expect([next.carriedOver,next.newThisWeek,next.total]).toEqual([375,0,375]);
    expect(next.rows[0]?.packages[0]?.paid).toBe(true);
    expect(week("2026-12-07",{events}).carriedOver).toBe(375);
  });
  it("retains clients with only carried balances even with no appointments",()=>{
    const result=week("2026-12-07",{events:[],whoOwes:[debt(375)]});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({carriedOver:375,newThisWeek:0,total:375,packages:[]});
  });
  it("retains a client with no current balance but only an earlier unpaid future package",()=>{
    const result=week("2026-12-07",{events:[event("earlier","2026-12-01")],whoOwes:[]});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({carriedOver:375,newThisWeek:0,total:375});
  });
  it("combines multiple selected packages into one client row and reconciles row totals",()=>{
    const other={...event("other","2026-12-03",false,200),client:{...client,id:"b",name:"Example B"}};
    const result=week("2026-11-30",{events:[event("first","2026-12-01"),event("second","2026-12-04"),other],whoOwes:[debt(375),debt(50,"b")]});
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({carriedOver:375,newThisWeek:750,total:1125});
    expect(result.rows[1]).toMatchObject({carriedOver:50,newThisWeek:200,total:250});
    expect([result.carriedOver,result.newThisWeek,result.total]).toEqual([425,950,1375]);
    expect(result.rows.reduce((s,r)=>s+r.total,0)).toBe(1375);
  });
  it("past weeks show expected and paid with no balance or projected carry-over",()=>{
    const result=week("2026-11-16",{events:[event("unpaid","2026-11-18"),event("paid","2026-11-20",true),event("future","2026-11-27")]});
    expect([result.expectedValue,result.paidValue,result.carriedOver]).toEqual([750,375,0]);
    expect(result.rows[0]).toMatchObject({carriedOver:0,newThisWeek:375,total:375,carriedPackages:[]});
  });
  it("does not offset future expected packages using negative balances",()=>{
    const result=week("2026-12-07",{events:[event("earlier","2026-12-01")],whoOwes:[debt(-375)]});
    expect([result.carriedOver,result.newThisWeek,result.total]).toEqual([375,0,375]);
  });
});