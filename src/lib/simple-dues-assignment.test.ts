import { describe, expect, it } from "vitest";
import { assignSimplePackages, buildSimpleRenewalWeek, computeSimpleDues, groupSimpleRenewSoon, simpleDuesAttentionCounts, type SimpleBooking, type SimplePackage, type SimpleRow } from "./simple-dues";

const now = "2026-12-05T18:00:00.000Z";
const client = { id: "c", name: "Example Client", archived: false };
const pkg = (extra: Partial<SimplePackage> = {}): SimplePackage => ({ id: "first", client_id: "c", visits: 8, price: 375, started_on: "2026-11-24", created_at: "2026-11-24T18:00:00Z", source: "manual", square_payment_id: null, flagged_for_review: false, reviewed_at: null, note: null, deleted_at: null, ...extra });
const booking = (id: string, date: string, extra: Partial<SimpleBooking> = {}): SimpleBooking => ({ id, clientId: "c", date, startAt: `${date}T15:00:00.000Z`, endAt: `${date}T15:45:00.000Z`, status: "ACCEPTED", ...extra });
const bookings = ["2026-11-24","2026-11-25","2026-11-26","2026-11-27","2026-11-28","2026-11-29","2026-11-30","2026-12-02","2026-12-04","2026-12-06","2026-12-08","2026-12-10","2026-12-12"].map((date,i) => booking(String(i),date));
const input = { clients: [client], packages: [pkg()], bookings, payments: [], openings: [], priceList: [], cutoverDate: "2026-11-24", now };
const noted = (size = 8) => bookings.map((b,i) => ({...b,sellerNote:i===0?`1 of ${size}`:null}));
const early = pkg({ id: "next", visits: 4, price: 200, source: "auto", square_payment_id: "receipt", started_on: "2026-11-27", created_at: "2026-11-27T20:00:00Z" });

describe("sequential simple package assignment", () => {
  it("early payment does not absorb remaining visits on the 8-visit package", () => {
    const result = assignSimplePackages([early,pkg()], noted().reverse(), now);
    expect(result.visits.slice(0,8).map(v => v.recordedPackageId)).toEqual(Array(8).fill("first"));
    expect(result.visits.map(v => v.label)).toEqual(["1/8","2/8","3/8","4/8","5/8","6/8","7/8","8/8","1/4","2/4","3/4","4/4","1/4"]);
    expect(result.visitsLeft).toBe(3);
  });
  it("visits left sums unused ended-visit slots across recorded packages, not future reservations", () => {
    expect(assignSimplePackages([pkg(),early],noted(), "2026-11-28T18:00:00.000Z").visitsLeft).toBe(7);
  });
  it("ties in started_on take turns by created_at, then stable id", () => {
    const a = pkg({id:"a",visits:2}); const b = pkg({id:"b",visits:1,created_at:"2026-11-24T19:00:00Z"});
    expect(assignSimplePackages([b,a],noted(2).slice(0,3),now).visits.map(v => v.recordedPackageId)).toEqual(["a","a","b"]);
    expect(assignSimplePackages([pkg({id:"b",visits:1}),pkg({id:"a",visits:1})],noted(1).slice(0,2),now).visits.map(v=>v.recordedPackageId)).toEqual(["a","b"]);
  });
  it("deleted packages and bookings before the first start never consume slots", () => {
    const result = assignSimplePackages([early,pkg({deleted_at:now})],[booking("old","2026-11-26"),...bookings],now);
    expect(result.visits[0]?.booking.date).toBe("2026-11-27");
    expect(result.visits[0]?.recordedPackageId).toBe("next");
    expect(result.visitsLeft).toBe(-2);
  });
  it.each(["CANCELLED_BY_SELLER","CANCELLED_BY_CUSTOMER","NO_SHOW","DECLINED","PENDING"])("%s never advances any cycle",status => {
    const result = assignSimplePackages([pkg({visits:1}),early],[booking("cancelled","2026-11-24",{status}),booking("ok","2026-11-25",{sellerNote:"1 of 1"})],now);
    expect(result.visits.map(v=>[v.booking.id,v.label,v.recordedPackageId])).toEqual([["ok","1/1","first"]]);
  });
  it("deduplicates, labels running appointments without consuming them, and includes ended COMPLETED", () => {
    const b=booking("past","2026-12-04",{status:"COMPLETED"});
    const result=assignSimplePackages([pkg()],[b,b,booking("running","2026-12-05",{startAt:"2026-12-05T17:45:00.000Z",endAt:"2026-12-05T18:30:00.000Z"}),booking("future-completed","2026-12-06",{status:"COMPLETED"}),booking("other","2026-12-04",{clientId:"other"})],now);
    expect(result.visits.map(v=>v.booking.id)).toEqual(["past","running"]);
    expect(result.visitsLeft).toBe(7);
  });
  it("every projected later cycle uses the last package size/price, never old payments", () => {
    const result=assignSimplePackages([pkg({visits:1}),early],bookings,now);
    expect(result.visits.filter(v=>v.newPackage).map(v=>[v.number,v.size,v.price,v.recordedPackageId])).toEqual([[1,4,200,null],[1,4,200,null]]);
  });
  it("recorded manual and auto packages are covered regardless of date, projections are not", () => {
    const board=computeSimpleDues({...input,bookings:noted(2),packages:[pkg({visits:2}),early]});
    expect(board.renewalEvents.slice(0,3).map(e=>[e.visit.booking.id,e.paid,e.expected])).toEqual([["0",true,0],["2",true,0],["6",false,200]]);
    expect(board.renewalEvents.filter(e=>!e.paid).every(e=>e.expected===200)).toBe(true);
  });
  it("upcoming renewals, labels and week picker agree on the early-paid boundary", () => {
    const board=computeSimpleDues({...input,bookings:noted(),packages:[pkg(),early],now:"2026-11-28T18:00:00.000Z"});
    expect(board.upcomingRenewals[0]).toMatchObject({paid:true,expected:0,visit:{number:1,size:4,recordedPackageId:"next",booking:{date:"2026-12-04"}}});
    expect(board.rows[0]?.upcomingVisits.find(v=>v.booking.date==="2026-12-04")?.label).toBe("1/4");
    const week=buildSimpleRenewalWeek({events:board.renewalEvents,whoOwes:[],selectedDate:"2026-12-04",now:"2026-11-28T18:00:00.000Z"});
    expect([week.paidValue,week.newThisWeek]).toEqual([200,0]);
  });
  it("opening packages are consumed first but are not new expected renewal value", () => {
    const board=computeSimpleDues({...input,bookings:noted(),packages:[pkg({source:"opening"}),early]});
    expect(board.renewalEvents.map(e=>e.visit.booking.id)).toEqual(["8","12"]);
    expect(board.renewalEvents.map(e=>e.paid)).toEqual([true,false]);
  });
  it("assignment changes no balance, receipt, override or input record", () => {
    const data={...input,packages:[pkg(),early],payments:[{id:"receipt",clientId:"c",amountCents:20000,currency:"USD",status:"COMPLETED",date:"2026-11-27"}]};
    const snapshot=JSON.stringify(data);
    const board=computeSimpleDues(data);
    expect([board.totalOwed,board.rows[0]?.balance]).toEqual([375,375]);
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

describe("missing simple packages", () => {
  it("upcoming ACCEPTED clients with no package are visible without invented debt", () => {
    const board=computeSimpleDues({...input,packages:[],bookings:[booking("next","2026-12-06")]});
    expect(board.needsPackage.map(r=>[r.client.name,r.next?.date,r.visitsSinceCutover])).toEqual([["Example Client","2026-12-06",0]]);
    expect([board.totalOwed,board.owingCount]).toEqual([0,0]);
  });
  it("ended bookings since cutover count once and reconcile actual receipts separately", () => {
    const b=booking("past","2026-11-24");
    const board=computeSimpleDues({...input,packages:[],bookings:[booking("old","2026-11-23"),b,b,booking("next","2026-12-06"),booking("cancelled","2026-11-25",{status:"CANCELLED_BY_SELLER"})],payments:[{id:"paid",clientId:"c",amountCents:5000,currency:"USD",status:"COMPLETED",date:"2026-11-24"}]});
    expect(board.needsPackage[0]?.visitsSinceCutover).toBe(1);
    expect(board.needsPackage[0]?.balance).toBe(-50);
    expect(board.whoOwes).toEqual([]);
  });
  it("past COMPLETED alone qualifies; pre-cutover, running or cancelled alone do not", () => {
    expect(computeSimpleDues({...input,packages:[],bookings:[booking("past","2026-11-24",{status:"COMPLETED"})]}).needsPackage).toHaveLength(1);
    for(const b of [booking("old","2026-11-23"),booking("cancelled","2026-12-06",{status:"CANCELLED_BY_CUSTOMER"}),booking("running","2026-12-05",{endAt:"2026-12-05T19:00:00.000Z"})])expect(computeSimpleDues({...input,packages:[],bookings:[b]}).needsPackage).toEqual([]);
  });
  it("any non-deleted package prevents a setup gap; removed packages do not", () => {
    expect(computeSimpleDues({...input,packages:[pkg({visits:0})]}).needsPackage).toEqual([]);
    expect(computeSimpleDues({...input,packages:[pkg({deleted_at:now})]}).needsPackage).toHaveLength(1);
  });
  it("archived clients and unreadable/unset-cutover activity never produce guesses", () => {
    for(const extra of [{clients:[{...client,archived:true}]},{bookingsReliable:false},{cutoverDate:null}])expect(computeSimpleDues({...input,packages:[],...extra}).needsPackage).toEqual([]);
  });
});

describe("renew soon visibility and attention counts", () => {
  const row=(id:string,left:number,nextDate:string|null=null):SimpleRow=>({client:{...client,id,name:id},balance:0,newest:pkg({client_id:id}),visitsLeft:left,next:nextDate?booking(id,nextDate,{clientId:id}):null,upcomingVisits:[],renewal:null,unmatchedPaymentIds:[]});
  it("over-package first, then zero, then by next date; all <=2 remain visible", () => {
    const rows=[row("two",2,"2026-12-06"),row("over",-3,"2026-12-12"),row("zero",0,"2026-12-10"),row("one",1,"2026-12-08")];
    expect(groupSimpleRenewSoon(rows,[],now).renewSoon.map(r=>r.client.id)).toEqual(["over","zero","two","one"]);
  });
  it("next booking projected 1/x qualifies even when visitsLeft >2", () => {
    const r=row("projected",3,"2026-12-06");
    r.upcomingVisits=[{booking:r.next??booking("fallback","2026-12-06"),number:1,size:8,label:"1/8",cycle:1,newPackage:true,price:375,recordedPackageId:null}];
    expect(groupSimpleRenewSoon([r],[],now).renewSoon.map(r=>r.client.id)).toEqual(["projected"]);
  });
  it("0 left/no recent bookings moves to inactive, never disappears; over remains active", () => {
    const rows=[row("inactive",0),row("over",-1)];
    const result=groupSimpleRenewSoon(rows,[booking("old","2026-11-04",{clientId:"inactive"})],now);
    expect(result.renewSoon.map(r=>r.client.id)).toEqual(["over"]);
    expect(result.inactiveRenewSoon.map(r=>r.client.id)).toEqual(["inactive"]);
  });
  it("exactly 30 days is recent; older or cancelled is not; upcoming keeps zero active", () => {
    const rows=[row("recent",0),row("older",0),row("cancelled",0),row("upcoming",0,"2026-12-06")];
    const activity=[booking("recent","2026-11-05",{clientId:"recent",startAt:"2026-11-05T18:00:00.000Z",endAt:"2026-11-05T18:45:00.000Z"}),booking("older","2026-11-05",{clientId:"older",startAt:"2026-11-05T17:59:59.000Z"}),booking("cancelled","2026-12-04",{clientId:"cancelled",status:"CANCELLED_BY_SELLER"})];
    expect(groupSimpleRenewSoon(rows,activity,now).renewSoon.map(r=>r.client.id)).toEqual(["upcoming","recent"]);
    expect(groupSimpleRenewSoon(rows,activity,now).inactiveRenewSoon.map(r=>r.client.id)).toEqual(["cancelled","older"]);
  });
  it("dashboard counts include collapsed inactive rows and actual flagged packages", () => {
    const counts=simpleDuesAttentionCounts({renewSoon:[row("active",1)],inactiveRenewSoon:[row("inactive",0)],needsPackage:[row("missing",0)],flagged:[pkg({flagged_for_review:true})]});
    expect(counts).toEqual({renewSoon:2,needsPackage:1,flagged:1});
  });
  it("failed booking reads withhold all three activity lists but retain known balances/flags", () => {
    const board=computeSimpleDues({...input,bookingsReliable:false,packages:[pkg({flagged_for_review:true})]});
    expect([board.renewSoon,board.inactiveRenewSoon,board.needsPackage,board.upcomingRenewals,board.renewalEvents]).toEqual([[],[],[],[],[]]);
    expect([board.totalOwed,board.flagged.length]).toEqual([375,1]);
    expect(board.rows[0]?.visitsLeft).toBeNull();
  });
});