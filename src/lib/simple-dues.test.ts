import { describe, it, expect } from "vitest";
import { assignSimplePackages, simpleBalance, simpleVisitsLeft, computeSimpleDues, newestSimplePackage, numberSimpleVisits, nextSimpleRenewal, simpleRenewalGroup, planAutoPackage, parseOpeningCsv, chicagoDate, SIMPLE_DEFAULT_PRICES, type SimplePackage, type SimplePayment, type SimpleBooking } from "./simple-dues";
const cutoverDate="2026-11-24";
const now="2026-12-01T18:00:00.000Z";
const pkg=(p:Partial<SimplePackage>={}):SimplePackage=>({id:"pkg",client_id:"c",visits:8,price:375,started_on:cutoverDate,source:"manual",square_payment_id:null,flagged_for_review:false,reviewed_at:null,note:null,created_at:"2026-11-24T18:00:00Z",deleted_at:null,...p});
const payment=(p:Partial<SimplePayment>={}):SimplePayment=>({id:"pay",clientId:"c",amountCents:37500,currency:"USD",status:"COMPLETED",date:cutoverDate,...p});
const booking=(p:Partial<SimpleBooking>={}):SimpleBooking=>({id:"b",clientId:"c",date:"2026-11-25",startAt:"2026-11-25T15:00:00.000Z",endAt:"2026-11-25T15:45:00.000Z",status:"ACCEPTED",...p});
const context={cutoverDate};
describe("simple auto package planner",()=>{
  it.each([[375,8,false],[345,8,false],[200,4,false],[100,2,true],[50,1,true]] as const)("exact $%s maps to %s visits and flag %s",(amount,visits,flag)=>expect(planAutoPackage(payment({amountCents:amount*100}),SIMPLE_DEFAULT_PRICES,context)).toMatchObject({kind:"add",visits,price:amount,flaggedForReview:flag,startedOn:cutoverDate}));
  it("nonmatching amount creates no package",()=>expect(planAutoPackage(payment({amountCents:37499}),SIMPLE_DEFAULT_PRICES,context)).toEqual({kind:"check",clientId:"c",paymentId:"pay"}));
  it("replay ignores existing receipt even if its package was removed",()=>expect(planAutoPackage(payment(),SIMPLE_DEFAULT_PRICES,{...context,existingPaymentIds:["pay"]})).toEqual({kind:"ignore"}));
  it("before cutover ignores completed payment",()=>expect(planAutoPackage(payment({date:"2026-11-23"}),SIMPLE_DEFAULT_PRICES,context)).toEqual({kind:"ignore"}));
  it("unset cutover ignores all payments",()=>expect(planAutoPackage(payment(),SIMPLE_DEFAULT_PRICES,{cutoverDate:null})).toEqual({kind:"ignore"}));
  it.each(["APPROVED","FAILED","CANCELED"])("%s payment adds nothing",status=>expect(planAutoPackage(payment({status}),SIMPLE_DEFAULT_PRICES,context).kind).toBe("ignore"));
  it("unlinked payment never guesses a client",()=>expect(planAutoPackage(payment({clientId:null}),SIMPLE_DEFAULT_PRICES,context).kind).toBe("ignore"));
  it("foreign currency cannot match dollar price",()=>expect(planAutoPackage(payment({currency:"CAD"}),SIMPLE_DEFAULT_PRICES,context).kind).toBe("ignore"));
});
describe("simple balance",()=>{
  it("opening + package prices - actual receipts",()=>expect(simpleBalance(100,[pkg(),pkg({id:"2",price:200})],[payment({amountCents:30000})],cutoverDate)).toBe(375));
  it("no calculations until cutover",()=>expect(simpleBalance(100,[pkg()],[payment()],null)).toBeNull());
  it("includes cutover day, excludes earlier packages/payments",()=>expect(simpleBalance(0,[pkg({started_on:"2026-11-23"}),pkg()],[payment({date:"2026-11-23"}),payment({id:"2",amountCents:10000})],cutoverDate)).toBe(275));
  it("negative is preserved, not carried or allocated anywhere",()=>expect(simpleBalance(0,[pkg()],[payment({amountCents:50000})],cutoverDate)).toBe(-125));
  it("soft deletion removes only package price, not receipt",()=>expect(simpleBalance(0,[pkg({deleted_at:now})],[payment()],cutoverDate)).toBe(-375));
  it("receipt replay does not reduce balance twice",()=>expect(simpleBalance(0,[pkg()],[payment(),payment()],cutoverDate)).toBe(0));
  it("not-completed and foreign payments do not change dollar balance",()=>expect(simpleBalance(0,[pkg()],[payment({status:"APPROVED"}),payment({id:"2",currency:"CAD"})],cutoverDate)).toBe(375));
  it("uses exact cents for nonstandard manually priced packages",()=>expect(simpleBalance(0,[pkg({price:123.45})],[payment({amountCents:12344})],cutoverDate)).toBe(0.01));
});
describe("simple visits",()=>{
  it("counts completed-time accepted bookings once, not note numbers",()=>expect(simpleVisitsLeft(pkg(),[booking(),booking()],now)).toBe(7));
  it.each(["CANCELLED_BY_SELLER","CANCELLED_BY_CUSTOMER","NO_SHOW","DECLINED","PENDING"])("does not count %s",status=>expect(simpleVisitsLeft(pkg(),[booking({status})],now)).toBe(8));
  it("future and currently running bookings do not count",()=>expect(simpleVisitsLeft(pkg(),[booking({endAt:"2026-12-01T19:00:00.000Z"})],now)).toBe(8));
  it("old-cycle bookings and other clients do not count",()=>expect(simpleVisitsLeft(pkg(),[booking({date:"2026-11-23"}),booking({id:"2",clientId:"other"})],now)).toBe(8));
  it("keeps overrun visible",()=>expect(simpleVisitsLeft(pkg({visits:0}),[booking()],now)).toBe(-1));
  it("newest package uses start date then created time",()=>expect(newestSimplePackage([pkg(),pkg({id:"2",started_on:"2026-11-26"}),pkg({id:"3",deleted_at:now,started_on:"2026-11-27"})],cutoverDate)?.id).toBe("2"));
  it("opening package before cutover still supplies remaining visits",()=>expect(newestSimplePackage([pkg({source:"opening",started_on:"2026-11-01"})],cutoverDate)?.visits).toBe(8));
});
describe("simple sections",()=>{
  const compute=(extra:Partial<Parameters<typeof computeSimpleDues>[0]>={})=>computeSimpleDues({clients:[{id:"c",name:"One",archived:false}],packages:[pkg()],payments:[],bookings:[],openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now,...extra});
  it("orders owing highest first and totals positive balances only",()=>{const b=compute({clients:[{id:"c",name:"One",archived:false},{id:"d",name:"Two",archived:false},{id:"e",name:"Three",archived:false}],packages:[pkg(),pkg({client_id:"d",id:"2",price:200})],payments:[payment({clientId:"e",amountCents:10000})]});expect(b.whoOwes.map(r=>r.client.id)).toEqual(["c","d"]);expect(b.totalOwed).toBe(575);expect(b.owingCount).toBe(2);expect(b.checkPackageInfo.map(r=>r.client.id)).toEqual(["e"]);});
  it("missing package alone never means debt",()=>{const b=compute({packages:[]});expect(b.totalOwed).toBe(0);expect(b.whoOwes).toEqual([]);});
  it("unmatched receipt is a setup review, not invented revenue",()=>{const b=compute({packages:[],payments:[payment({amountCents:12000})]});expect(b.checkPackageInfo[0]?.balance).toBe(-120);expect(b.whoOwes).toEqual([]);});
  it("reviewed packages leave Dad section without changing balance",()=>{const b=compute({packages:[pkg({source:"auto",flagged_for_review:true,reviewed_at:now})]});expect(b.flagged).toEqual([]);expect(b.totalOwed).toBe(375);});
  it("unreviewed flagged package appears",()=>expect(compute({packages:[pkg({source:"auto",flagged_for_review:true})]}).flagged.length).toBe(1));
  it.each([2,1,-1])("%s visits left is renew soon",visits=>expect(compute({packages:[pkg({visits})]}).renewSoon.length).toBe(1));
  it("zero left without activity is retained in inactive renewals",()=>expect(compute({packages:[pkg({visits:0})]}).inactiveRenewSoon).toHaveLength(1));
  it("three remaining is not renew soon",()=>expect(compute({packages:[pkg({visits:3})]}).renewSoon).toEqual([]));
  it("zero left with future booking remains in renew soon",()=>expect(compute({packages:[pkg({visits:0})],bookings:[booking({startAt:"2026-12-02T15:00:00.000Z",endAt:"2026-12-02T15:45:00.000Z"})]}).renewSoon[0]?.next?.id).toBe("b"));
  it("unreadable bookings suppresses visit and renewal guesses",()=>{const b=compute({packages:[pkg({visits:0})],bookingsReliable:false});expect(b.renewSoon).toEqual([]);expect(b.rows[0]?.visitsLeft).toBeNull();});
  it("archived clients are excluded without deleting their records",()=>{const b=compute({clients:[{id:"c",name:"One",archived:true}]});expect(b.rows).toEqual([]);expect(b.totalOwed).toBe(0);});
  it("all action sections off until cutover",()=>{const b=compute({cutoverDate:null,packages:[pkg({visits:0,flagged_for_review:true})]});expect([b.whoOwes.length,b.flagged.length,b.checkPackageInfo.length,b.renewSoon.length]).toEqual([0,0,0,0]);});
});
describe("opening import",()=>{
  const clients=[{id:"c",name:"One Client",archived:false}];
  it("accepts header, case-insensitive names and negative opening balance",()=>expect(parseOpeningCsv('client name,amount\n"one client",-50.25',clients)).toEqual([{client_id:"c",amount:-50.25,note:"Opening balance CSV import"}]));
  it("accepts explicit id",()=>expect(parseOpeningCsv("c,375",clients)[0]?.amount).toBe(375));
  it("rejects unknown client before import",()=>expect(()=>parseOpeningCsv("unknown,375",clients)).toThrow("unknown"));
  it("rejects ambiguous names",()=>expect(()=>parseOpeningCsv("One Client,375",[...clients,{id:"d",name:"One Client",archived:false}])).toThrow("ambiguous"));
  it("rejects duplicates",()=>expect(()=>parseOpeningCsv("c,375\nc,200",clients)).toThrow("duplicate"));
  it("rejects empty/invalid amounts",()=>expect(()=>parseOpeningCsv("c,",clients)).toThrow("invalid amount"));
  it("uses Chicago receipt date rather than UTC",()=>expect(chicagoDate("2026-11-24T02:00:00Z")).toBe("2026-11-23"));
});

describe("read-only simple visit numbering and renewal projection",()=>{
  const client={id:'c',name:'Example Client',archived:false};
  const at=(id:number,day:string,status='ACCEPTED')=>booking({id:String(id),date:day,startAt:`${day}T15:00:00.000Z`,endAt:`${day}T15:45:00.000Z`,status});
  const eight=[24,25,26,27,28,29,30].map((day,i)=>at(i+1,`2026-11-${day}`)).concat(at(8,'2026-12-02'),at(9,'2026-12-04'),at(10,'2026-12-09'));
  it('labels completed past bookings first then accepted future reservations in time order',()=>{
    const visits=numberSimpleVisits(pkg(),eight.slice().reverse(),now);
    expect(visits.map(v=>v.label)).toEqual(['1/8','2/8','3/8','4/8','5/8','6/8','7/8','8/8','1/8','2/8']);
    expect(visits[8]).toMatchObject({newPackage:true,price:375,cycle:1});
  });
  it('restarts each subsequent projected package with the same size and price',()=>{
    expect(numberSimpleVisits(pkg({visits:2,price:100}),eight,now).map(v=>[v.label,v.newPackage,v.price])).toEqual([['1/2',false,100],['2/2',false,100],['1/2',true,100],['2/2',false,100],['1/2',true,100],['2/2',false,100],['1/2',true,100],['2/2',false,100],['1/2',true,100],['2/2',false,100]]);
  });
  it.each(['CANCELLED_BY_SELLER','CANCELLED_BY_CUSTOMER','CANCELED','NO_SHOW','DECLINED','PENDING'])('skips %s without advancing numbering',status=>{
    expect(numberSimpleVisits(pkg(),[at(1,'2026-11-25',status),at(2,'2026-12-02',status),at(3,'2026-12-04')],now).map(v=>v.label)).toEqual(['1/8']);
  });
  it('skips old dates, other clients, duplicate bookings, running bookings and future COMPLETED states',()=>{
    const b=at(1,'2026-11-25');
    expect(numberSimpleVisits(pkg(),[at(0,'2026-11-23'),b,b,{...b,id:'other',clientId:'d'},booking({id:'running',startAt:'2026-12-01T17:45:00.000Z',endAt:'2026-12-01T18:30:00.000Z'}),at(9,'2026-12-02','COMPLETED')],now).map(v=>v.booking.id)).toEqual(['1','running']);
  });
  it('accepts past completed bookings after the full duration ends',()=>expect(numberSimpleVisits(pkg(),[at(1,'2026-11-25','COMPLETED')],now)[0]?.label).toBe('1/8'));
  it('zero/invalid/removed packages never produce a division by zero or renewal guess',()=>{
    for(const p of [pkg({visits:0}),pkg({visits:-1}),pkg({visits:1.5}),pkg({deleted_at:now})])expect(numberSimpleVisits(p,eight,now)).toEqual([]);
  });
  it('selects one next future 1/8 even when a previous projected renewal was in the past',()=>{
    const v=numberSimpleVisits(pkg({visits:2}),eight,now);
    expect(nextSimpleRenewal(client,v,[pkg({visits:2})],now)?.visit.booking.id).toBe('9');
  });
  it('no booking after the last package visit means no upcoming renewal',()=>expect(nextSimpleRenewal(client,numberSimpleVisits(pkg(),eight.slice(0,8),now),[],now)).toBeNull());
  it('matching recorded package on the renewal date is Paid, not expected revenue',()=>{
    const packages=[pkg(),pkg({id:'next',started_on:'2026-12-04'})];
    const r=nextSimpleRenewal(client,assignSimplePackages(packages,eight,now).visits,packages,now);
    expect(r).toMatchObject({paid:true,expected:0});
  });
  it('matching auto-added package after the renewal date is Paid',()=>{
    const packages=[pkg(),pkg({id:'auto',source:'auto',square_payment_id:'receipt',started_on:'2026-12-05'})];
    expect(nextSimpleRenewal(client,assignSimplePackages(packages,eight,now).visits,packages,now)).toMatchObject({paid:true,expected:0});
  });
  it('old auto-payment package is not general credit for the next projected cycle',()=>{
    expect(nextSimpleRenewal(client,numberSimpleVisits(pkg(),eight,now),[pkg({source:'auto',square_payment_id:'old-receipt'})],now)).toMatchObject({paid:false,expected:375});
  });
  it('an early matching auto purchase pays only its first reserved cycle, never the following renewal',()=>{
    const p=pkg({source:'auto',square_payment_id:'matching-receipt'});const bookings=[at(1,'2026-12-02')];
    const input={clients:[client],packages:[p],payments:[payment()],bookings,openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now};
    expect(computeSimpleDues(input).upcomingRenewals[0]).toMatchObject({paid:true,expected:0});
    expect(computeSimpleDues({...input,bookings:eight}).upcomingRenewals[0]).toMatchObject({paid:false,expected:375});
  });
  it('a recorded future-start package keeps its future first booking visible as Paid',()=>{
    const b=computeSimpleDues({clients:[client],packages:[pkg({started_on:'2026-12-02'})],payments:[],bookings:[at(1,'2026-12-02')],openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now});
    expect(b.upcomingRenewals[0]).toMatchObject({paid:true,expected:0});expect(b.renewalExpected).toEqual({thisWeek:0,nextWeek:0});
  });
  it('removed, other-client, wrong-price or wrong-size packages cannot mark a matching renewal paid',()=>{
    const matches=[pkg({started_on:'2026-12-04',deleted_at:now}),pkg({started_on:'2026-12-04',client_id:'d'}),pkg({started_on:'2026-12-04',price:345}),pkg({started_on:'2026-12-04',visits:4})];
    expect(nextSimpleRenewal(client,numberSimpleVisits(pkg(),eight,now),matches,now)).toMatchObject({paid:false,expected:375});
  });
  it.each([['2026-12-06','This week'],['2026-12-07','Next week'],['2026-12-13','Next week'],['2026-12-14','Later']] as const)('groups %s as %s in Monday–Sunday Chicago weeks',(date,group)=>expect(simpleRenewalGroup(date,now)).toBe(group));
  it('uses Chicago date at midnight across a UTC week boundary',()=>expect(simpleRenewalGroup('2026-11-30','2026-11-30T02:00:00Z')).toBe('Next week'));
  it('adds forecasts without changing balances, debt membership, remaining visits or input records',()=>{
    const input={clients:[client],packages:[pkg()],payments:[payment()],bookings:eight,openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now};
    const snapshot=JSON.stringify(input); const b=computeSimpleDues(input);
    expect(b.totalOwed).toBe(0);expect(b.whoOwes).toEqual([]);expect(b.rows[0]?.visitsLeft).toBe(1);
    expect(b.rows[0]?.upcomingVisits.map(v=>v.label)).toEqual(['8/8','1/8','2/8']);
    expect(b.upcomingRenewals).toHaveLength(1);expect(b.renewalExpected).toEqual({thisWeek:375,nextWeek:0});
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it('totals unpaid expected amounts by week in cents and excludes an already paid first cycle',()=>{
    const clients=[client,{id:'d',name:'Next Client',archived:false},{id:'e',name:'Paid Client',archived:false}];
    const packages=[pkg({visits:2,price:123.45}),pkg({id:'d',client_id:'d',visits:2,price:200}),pkg({id:'e',client_id:'e',source:'auto',square_payment_id:'matched'})];
    const bookings=[at(1,'2026-11-25'),at(2,'2026-11-26'),at(3,'2026-12-04'),...['2026-11-25','2026-11-26','2026-12-09'].map((day,i)=>({...at(i+10,day),clientId:'d'})),{...at(20,'2026-12-02'),clientId:'e'}];
    const b=computeSimpleDues({clients,packages,payments:[],bookings,openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now});
    expect(b.upcomingRenewals).toHaveLength(3);expect(b.renewalExpected).toEqual({thisWeek:123.45,nextWeek:200});expect(b.upcomingRenewals.find(r=>r.client.id==='e')?.paid).toBe(true);
  });
  it('recorded packages take turns before projecting from the last size and price',()=>{
    const b=computeSimpleDues({clients:[client],packages:[pkg({id:'old',visits:4}),pkg({id:'new',visits:2,price:200,started_on:'2026-12-02'})],payments:[],bookings:eight.map((b,i)=>({...b,sellerNote:i===0?'1/4':null})),openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now:'2026-12-03T18:00:00.000Z'});
    expect(b.rows[0]?.upcomingVisits.map(v=>v.label)).toEqual(['1/2','2/2']);expect(b.upcomingRenewals[0]).toMatchObject({paid:false,expected:200,group:'This week'});
  });
  it('incomplete appointment reads and unset cutover suppress all new projections',()=>{
    for(const extra of [{bookingsReliable:false},{cutoverDate:null}]){
      const b=computeSimpleDues({clients:[client],packages:[pkg()],payments:[],bookings:eight,openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate,now,...extra});
      expect(b.upcomingRenewals).toEqual([]);expect(b.rows[0]?.upcomingVisits).toEqual([]);expect(b.renewalExpected).toEqual({thisWeek:0,nextWeek:0});
    }
  });
});