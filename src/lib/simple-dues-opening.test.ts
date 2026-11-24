import {describe,it,expect} from "vitest";
import {planOpeningPackages,type OpeningClient,type OpeningOverride} from "./simple-dues-opening";
import {simpleBalance,computeSimpleDues,unlinkedSimplePayments,type SimplePackage} from "./simple-dues";
const client:OpeningClient={id:"c",first_name:"Example",last_name:"Client",status:"active",deleted_at:null,package_total_visits:8,package_price:375,package_start_date:"2026-11-01"};
const override=(p:Partial<OpeningOverride>={}):OpeningOverride=>({id:"o",client_id:"c",slot:"current",total_visits:4,visits_used:0,price:200,recognized_paid:0,start_date:"2026-11-10",status:"active",created_at:"2026-11-15T00:00:00Z",cleared_at:null,...p});
const plan=(clients=[client],overrides:OpeningOverride[]=[],existing:Parameters<typeof planOpeningPackages>[2]=[])=>planOpeningPackages(clients,overrides,existing,"2026-11-24");
describe("opening packages",()=>{
 it("current override wins for size price and start",()=>expect(plan([client],[override()]).rows).toEqual([{client_id:"c",visits:4,price:200,started_on:"2026-11-10"}]));
 it("latest created current override wins independent of input order",()=>expect(plan([client],[override(),override({id:"new",price:215,created_at:"2026-11-20T00:00:00Z"})]).rows[0]?.price).toBe(215));
 it("cleared and pending overrides are ignored",()=>expect(plan([client],[override({cleared_at:"2026-11-21"}),override({id:"p",slot:"pending"})]).rows[0]?.price).toBe(375));
 it("nullable override fields fall back to raw current package",()=>expect(plan([client],[override({price:null,total_visits:null,start_date:null})]).rows[0]).toEqual({client_id:"c",visits:8,price:375,started_on:"2026-11-01"}));
 it.each([{package_total_visits:0},{package_start_date:null}])("missing info is listed and never inserted %j",change=>{const result=plan([{...client,...change}]);expect(result.rows).toEqual([]);expect(result.noPackageInfo).toEqual([{id:"c",name:"Example Client"}]);});
 it("override zero visits skips even when raw visits positive",()=>expect(plan([client],[override({total_visits:0})]).noPackageInfo.length).toBe(1));
 it.each([{status:"archived"},{status:"inactive"},{deleted_at:"2026-11-01"}])("excludes inactive client %j",change=>expect(plan([{...client,...change}]).rows).toEqual([]));
 it("never creates another opening even when existing opening soft deleted",()=>{const first=plan();expect(first.rows.length).toBe(1);const second=plan([client],[],first.rows.map(r=>({client_id:r.client_id,source:"opening"})));expect(second.rows).toEqual([]);expect(second.alreadyCreated).toBe(1);});
 it("manual package does not prevent the single opening snapshot",()=>expect(plan([client],[],[{client_id:"c",source:"manual"}]).rows.length).toBe(1));
 it("does not shift start or charge an opening on/after cutover",()=>{const result=plan([{...client,package_start_date:"2026-11-24"}]);expect(result.rows).toEqual([]);expect(result.notBeforeCutover.length).toBe(1);});
 it("opening excluded from balance but used for remaining visits and renew soon",()=>{
   const p:SimplePackage={id:"o",...plan().rows[0],client_id:"c",visits:2,price:375,started_on:"2026-11-01",source:"opening",square_payment_id:null,flagged_for_review:false,reviewed_at:null,note:null,created_at:"2026-11-24",deleted_at:null};
   const result=computeSimpleDues({clients:[{id:"c",name:"Example Client",archived:false}],packages:[p],payments:[],bookings:[{id:"b",clientId:"c",date:"2026-11-05",startAt:"2026-11-05T15:00:00Z",endAt:"2026-11-05T15:45:00Z",status:"ACCEPTED"}],openings:[],priceList:[],cutoverDate:"2026-11-24",now:"2026-11-24T18:00:00Z"});
   expect(result.totalOwed).toBe(0);expect(result.rows[0]?.visitsLeft).toBe(1);expect(result.renewSoon.length).toBe(1);
   expect(simpleBalance(0,[{...p,started_on:"2026-11-24"}],[],"2026-11-24")).toBe(0);
 });
});
describe("unlinked simple receipts",()=>{
 const p={id:"pay",clientId:null,amountCents:9500,currency:"USD",status:"COMPLETED",date:"2026-11-24",buyerName:"Example Buyer",buyerEmail:"buyer@example.com"};
 it("includes full read-only details and includes cutover day",()=>expect(unlinkedSimplePayments([p],"2026-11-24")).toEqual([p]));
 it("excludes linked before-cutover and non-completed",()=>expect(unlinkedSimplePayments([{...p,clientId:"c"},{...p,id:"old",date:"2026-11-23"},{...p,id:"pending",status:"APPROVED"}],"2026-11-24")).toEqual([]));
 it("deduplicates receipt replay",()=>expect(unlinkedSimplePayments([p,p],"2026-11-24").length).toBe(1));
 it("unset cutover displays no receipts",()=>expect(unlinkedSimplePayments([p],null)).toEqual([]));
 it("retains non-dollar receipts for review without adding to dollar balance",()=>expect(unlinkedSimplePayments([{...p,currency:"CAD"}],"2026-11-24")[0]?.currency).toBe("CAD"));
});