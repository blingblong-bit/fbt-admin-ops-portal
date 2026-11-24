import { describe, expect, it } from "vitest";
import { computeSimpleDues, type SimplePackage } from "./simple-dues";
import { daysBefore, simplePaymentEvidence, type HistoryPayment } from "./simple-payment-history";

const client={id:"example",name:"Example Client",archived:false};
const openingPackage:SimplePackage={id:"opening",client_id:client.id,visits:8,price:375,started_on:"2026-11-01",source:"opening",square_payment_id:null,flagged_for_review:false,reviewed_at:null,note:null,created_at:"2026-11-24T00:00:00Z",deleted_at:null};
const payment=(date:string,amount=375,status="COMPLETED",clientId:string|null=client.id):HistoryPayment=>({id:`${date}-${amount}`,clientId,amountCents:amount*100,currency:"USD",status,date:date.slice(0,10),paidAt:date.includes("T")?date:`${date}T18:00:00Z`});
const evidence=(completed:HistoryPayment[],extra:Partial<Parameters<typeof simplePaymentEvidence>[0]>={})=>simplePaymentEvidence({clients:[client],completed,packages:[openingPackage],openings:[{client_id:client.id,amount:375}],cutoverDate:"2026-11-24",...extra});

describe("display-only Square payment evidence",()=>{
  it("history never changes a $375 opening balance or the owing count",()=>{
    const display=evidence([payment("2026-11-16")]);
    const board=computeSimpleDues({clients:[client],packages:[openingPackage],payments:[],bookings:[],openings:[{client_id:client.id,amount:375}],priceList:[],cutoverDate:"2026-11-24",now:"2026-11-24T18:00:00Z"});
    expect(display.paymentHistory).toHaveLength(1);
    expect(board.totalOwed).toBe(375);
    expect(board.owingCount).toBe(1);
    expect(board.rows[0]?.balance).toBe(375);
  });
  it("newest completed payment wins before/after cutover and within the same day",()=>{
    const display=evidence([payment("2026-11-24T12:00:00Z",50),payment("2026-11-16"),payment("2026-11-25",900,"FAILED"),payment("2026-11-24T18:00:00Z",200),payment("2026-11-26",800,"PENDING")]);
    expect(display.lastPayments[client.id]).toEqual({date:"2026-11-24",amount:200});
    expect(display.paymentHistory.map(p=>p.date)).toEqual(["2026-11-16"]);
  });
  it("last payment includes older history even when the board history excludes it",()=>{
    const oldest=payment("2026-01-01",50);
    expect(evidence([oldest]).lastPayments[client.id]).toEqual({date:"2026-01-01",amount:50});
    expect(evidence([oldest]).paymentHistory).toEqual([]);
    expect(evidence([oldest],{fullHistory:true}).paymentHistory).toEqual([oldest]);
  });
  it("includes the 180-day boundary, excludes the day before it and keeps newest first",()=>{
    expect(daysBefore("2026-11-24",180)).toBe("2026-05-28");
    expect(evidence([payment("2026-05-27"),payment("2026-05-28"),payment("2026-11-16")]).paymentHistory.map(p=>p.date)).toEqual(["2026-11-16","2026-05-28"]);
  });
  it("unlinked, failed and other-client payments cannot become a client's last payment",()=>{
    expect(evidence([payment("2026-11-16",50,"COMPLETED",null),payment("2026-11-17",50,"COMPLETED","other"),payment("2026-11-18",50,"FAILED")]).lastPayments[client.id]).toBeNull();
  });
});
describe("Check opening balances selection (never an automatic correction)",()=>{
  it("includes nonzero openings at the inclusive 21-day boundary",()=>{
    const rows=evidence([payment("2026-11-03")],{packages:[]}).checkOpenings;
    expect(rows.map(r=>r.client.id)).toEqual([client.id]);
    expect(rows[0]?.openingBalance).toBe(375);
    expect(rows[0]?.openingPackage).toBeNull();
    expect(evidence([payment("2026-11-02")],{packages:[]}).checkOpenings).toEqual([]);
  });
  it("includes payment on/after the opening package start even outside 21 days",()=>{
    expect(evidence([payment("2026-11-01")]).checkOpenings[0]?.openingPackage).toEqual(openingPackage);
    expect(evidence([payment("2026-10-31")]).checkOpenings).toEqual([]);
    expect(evidence([payment("2026-11-24")]).checkOpenings.map(r=>r.client.id)).toEqual([client.id]);
  });
  it("post-cutover alone does not qualify without an opening package",()=>{
    expect(evidence([payment("2026-11-24")],{packages:[]}).checkOpenings).toEqual([]);
  });
  it("zero, missing, archived, deleted opening packages, unlinked and failed evidence are excluded",()=>{
    expect(evidence([payment("2026-11-16")],{openings:[{client_id:client.id,amount:0}]}).checkOpenings).toEqual([]);
    expect(evidence([payment("2026-11-16")],{openings:[]}).checkOpenings).toEqual([]);
    expect(evidence([payment("2026-11-16")],{clients:[{...client,archived:true}]}).checkOpenings).toEqual([]);
    expect(evidence([payment("2026-11-01")],{packages:[{...openingPackage,deleted_at:"2026-11-23"}]}).checkOpenings).toEqual([]);
    expect(evidence([payment("2026-11-16",50,"COMPLETED",null),payment("2026-11-16",50,"FAILED")]).checkOpenings).toEqual([]);
  });
  it("negative nonzero openings are also reviewable and cutover unset yields no review list",()=>{
    expect(evidence([payment("2026-11-16")],{openings:[{client_id:client.id,amount:-50}]}).checkOpenings[0]?.openingBalance).toBe(-50);
    expect(evidence([payment("2026-11-16")],{cutoverDate:null}).checkOpenings).toEqual([]);
  });
});