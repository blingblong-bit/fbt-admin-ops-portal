import { describe, expect, it } from "vitest";
import { computeSimpleDues, buildSimpleRenewalWeek, type SimplePackage, type SimpleBooking, SIMPLE_DEFAULT_PRICES } from "./simple-dues";
import { duesTileCounts, selectedDuesList, simpleCurrentPackage } from "./simple-dues-view";
const now="2026-11-24T18:00:00Z";
const pkg:SimplePackage={id:"p",client_id:"c",visits:8,price:375,started_on:"2026-11-24",source:"manual",square_payment_id:null,flagged_for_review:true,reviewed_at:null,note:null,created_at:now,deleted_at:null};
const bookings:SimpleBooking[]=Array.from({length:9},(_,i)=>({id:`b${i}`,clientId:"c",date:"2026-11-24",startAt:new Date(Date.parse(now)+(i===0?-1:i)*3600000).toISOString(),endAt:new Date(Date.parse(now)+(i===0?-1:i)*3600000+2700000).toISOString(),status:"ACCEPTED"}));
describe("Dues tile selection and counts",()=>{
  it("default and invalid search values open nothing",()=>{
    expect(selectedDuesList("")).toBeNull();expect(selectedDuesList("bad")).toBeNull();
    expect(selectedDuesList("who-owes")).toBe("who-owes");
  });
  const board=computeSimpleDues({clients:[{id:"c",name:"Example",archived:false},{id:"missing",name:"Missing",archived:false}],packages:[pkg],payments:[],bookings:[...bookings,{...bookings[0],id:"missing",clientId:"missing"}],openings:[],priceList:SIMPLE_DEFAULT_PRICES,cutoverDate:"2026-11-24",now});
  const data={...board,unlinkedPayments:[{id:"unlinked"}]};
  const week=buildSimpleRenewalWeek({events:board.renewalEvents,whoOwes:board.whoOwes,selectedDate:"2026-11-24",now});
  it("Who owes uses the exact list length and unchanged $375 total",()=>{expect(duesTileCounts(data,week)["who-owes"]).toBe(1);expect(board.totalOwed).toBe(375);});
  it("Needs a package matches the missing-client list",()=>{expect(duesTileCounts(data,week)["needs-package"]).toBe(1);expect(board.needsPackage.map(r=>r.client.id)).toEqual(["missing"]);});
  it("Flagged matches package rows, not clients",()=>expect(duesTileCounts({...data,flagged:[pkg,{...pkg,id:"p2"}]},week).flagged).toBe(2));
  it("Check package info includes unlinked payment rows",()=>expect(duesTileCounts(data,week)["check-package-info"]).toBe(1));
  it("Renew soon includes both visible and collapsed inactive rows",()=>expect(duesTileCounts({...data,renewSoon:[board.rows[0]],inactiveRenewSoon:[board.rows[1]]},week)["renew-soon"]).toBe(2));
  it("Upcoming renewals matches this week's actual client rows",()=>{expect(duesTileCounts(data,week)["upcoming-renewals"]).toBe(week.rows.length);expect(week.total).toBe(750);});
  it("empty lists give six zero counts",()=>expect(duesTileCounts({whoOwes:[],needsPackage:[],flagged:[],checkPackageInfo:[],unlinkedPayments:[],renewSoon:[],inactiveRenewSoon:[]},{rows:[]})).toEqual({"who-owes":0,"needs-package":0,flagged:0,"check-package-info":0,"renew-soon":0,"upcoming-renewals":0}));
});
describe("current simple package display",()=>{
  it("shows eight visits/$375, 7/8 left and the projected next 1/8",()=>{
    const summary=simpleCurrentPackage([pkg],bookings,now,true);
    expect(summary.package).toMatchObject({visits:8,price:375,started_on:"2026-11-24"});
    expect(summary.visitsLeft).toBe(7);expect(summary.nextStart).toMatchObject({number:1,size:8,newPackage:true});
  });
  it("an early next package does not replace the current remaining capacity",()=>{
    expect(simpleCurrentPackage([pkg,{...pkg,id:"next",visits:4,price:200,started_on:"2026-11-25"}],bookings.map((b,i)=>({...b,sellerNote:i===0?"1/8":null})),now,true).package?.id).toBe("p");
  });
  it("cancelled visits do not consume capacity",()=>expect(simpleCurrentPackage([pkg],[{...bookings[0],status:"CANCELLED_BY_SELLER"}],now,true).visitsLeft).toBe(8));
  it("incomplete appointment reads do not guess current progress",()=>expect(simpleCurrentPackage([pkg],bookings,now,false)).toMatchObject({reliable:false,visitsLeft:null,nextStart:null}));
});