import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { chicagoDate, planAutoPackage } from "./simple-dues";
/** Isolated follow-on: never changes legacy ledger/allocations and cannot fail the original webhook. */
export async function ingestSimplePayment(db: SupabaseClient<Database>, paymentId: string | null) {
  if (!paymentId) return;
  try {
    const {data:settings,error:settingsError}=await db.from("simple_dues_settings").select("cutover_date").eq("id",true).maybeSingle();
    if(settingsError)throw settingsError;
    if(!settings?.cutover_date)return;
    const [receipt,prices,existing]=await Promise.all([
      db.from("square_payments").select("square_payment_id,client_id,amount_cents,currency,status,created_at,raw_event").eq("square_payment_id",paymentId).maybeSingle(),
      db.from("simple_price_list").select("*"),
      db.from("simple_packages").select("square_payment_id").eq("square_payment_id",paymentId).maybeSingle(),
    ]);
    if(receipt.error||prices.error||existing.error)throw receipt.error??prices.error??existing.error;
    const p=receipt.data;if(!p)return;
    const event=p.raw_event as {data?:{object?:{payment?:{created_at?:string}}}}|null;
    const plan=planAutoPackage({id:p.square_payment_id,clientId:p.client_id,amountCents:p.amount_cents,currency:p.currency,status:p.status??"",date:chicagoDate(event?.data?.object?.payment?.created_at??p.created_at)},(prices.data??[]).map(r=>({...r,amount:Number(r.amount)})),{cutoverDate:settings.cutover_date,existingPaymentIds:existing.data?[paymentId]:[]});
    if(plan.kind!=="add")return;
    // The recorder revalidates cutover/price and enforces the unique receipt atomically.
    const {error} = await db.rpc("simple_record_payment", {_payment_id:paymentId});
    if(error) console.error("[simple-dues] follow-on failed; retry from Dues",error.message);
  } catch(error) { console.error("[simple-dues] follow-on failed; retry from Dues", error instanceof Error ? error.message : "Unknown error"); }
}