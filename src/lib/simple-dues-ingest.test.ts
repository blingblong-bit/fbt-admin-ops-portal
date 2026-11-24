import {describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/integrations/supabase/types";
import {ingestSimplePayment} from "./simple-dues-ingest.server";
describe("isolated simple payment follow-on",()=>{
  function mockDb(rpc:ReturnType<typeof vi.fn>,cutover:string|null="2026-11-24") {
    return {rpc,from:(table:string)=>{const result={data:table==="simple_dues_settings"?{cutover_date:cutover}:table==="square_payments"?{square_payment_id:"p",client_id:"c",amount_cents:37500,currency:"USD",status:"COMPLETED",created_at:"2026-11-24T18:00:00Z",raw_event:null}:table==="simple_price_list"?[{amount:375,visits:8,flag_for_review:false}]:null,error:null};const chain={select:()=>chain,eq:()=>chain,maybeSingle:()=>Promise.resolve(result),then:(resolve:(r:typeof result)=>unknown)=>Promise.resolve(result).then(resolve)};return chain;}} as unknown as SupabaseClient<Database>;
  }
  it("plans the package then calls only the new recorder",async()=>{const rpc=vi.fn().mockResolvedValue({error:null});await ingestSimplePayment(mockDb(rpc),"p");expect(rpc).toHaveBeenCalledExactlyOnceWith("simple_record_payment",{_payment_id:"p"});});
  it("unset cutover makes no writes",async()=>{const rpc=vi.fn();await ingestSimplePayment(mockDb(rpc,null),"p");expect(rpc).not.toHaveBeenCalled();});
  it("never changes original webhook success on RPC error",async()=>{const log=vi.spyOn(console,"error").mockImplementation(()=>{});const rpc=vi.fn().mockResolvedValue({error:{message:"failed"}});await expect(ingestSimplePayment(mockDb(rpc),"p")).resolves.toBeUndefined();expect(rpc).toHaveBeenCalled();expect(log).toHaveBeenCalled();log.mockRestore();});
  it("never changes original webhook success on thrown error",async()=>{const log=vi.spyOn(console,"error").mockImplementation(()=>{});const rpc=vi.fn().mockRejectedValue(new Error("offline"));await expect(ingestSimplePayment(mockDb(rpc),"p")).resolves.toBeUndefined();expect(rpc).toHaveBeenCalled();log.mockRestore();});
  it("missing payment id performs no work",async()=>{const rpc=vi.fn();await ingestSimplePayment({rpc} as unknown as SupabaseClient<Database>,null);expect(rpc).not.toHaveBeenCalled();});
});