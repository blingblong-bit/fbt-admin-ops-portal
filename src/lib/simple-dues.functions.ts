import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchSquareBookings } from "@/lib/schedule.functions";
import { chicagoDate, computeSimpleDues, parseOpeningCsv, unlinkedSimplePayments, SIMPLE_DEFAULT_PRICES, type SimplePackage, type SimplePayment, type SimpleBooking, type SimplePrice, type SimpleClient } from "./simple-dues";
import {planOpeningPackages,type OpeningOverride} from "./simple-dues-opening";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function admin(db: SupabaseClient<Database>, userId: string) {
  const {data,error}=await db.from("user_roles").select("role").eq("user_id",userId);
  if(error || !data?.some(r=>r.role==="admin" || r.role==="superadmin")) throw new Error("Admin access required");
}
async function all<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[]=[];
  for(let from=0;;from+=500) {const result=await page(from,from+499); if(result.error) throw result.error; rows.push(...result.data??[]); if((result.data?.length??0)<500) return rows; if(from>100000) throw new Error("Too many rows; narrow the date range");}
}
const scope=z.object({clientId:z.string().uuid().optional()});
export const getSimpleDues=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>scope.parse(d??{})).handler(async({data,context})=>{
  const db=context.supabase;
  if(!data.clientId) await admin(db,context.userId);
  const {data:settings,error:settingsError}=await db.from("simple_dues_settings").select("cutover_date").eq("id",true).maybeSingle();
  if(settingsError) throw settingsError;
  const cutoverDate=settings?.cutover_date??null;
  const [rawClients,rawPackages,openings,prices]=await Promise.all([
    all((from,to)=>{let q=db.from("clients").select("id,first_name,last_name,square_customer_id,status,deleted_at").order("id");if(data.clientId)q=q.eq("id",data.clientId);return q.range(from,to);}),
    all((from,to)=>{let q=db.from("simple_packages").select("*").order("id");if(data.clientId)q=q.eq("client_id",data.clientId);return q.range(from,to);}),
    all((from,to)=>{let q=db.from("simple_opening_balances").select("*").order("client_id");if(data.clientId)q=q.eq("client_id",data.clientId);return q.range(from,to);}),
    all((from,to)=>db.from("simple_price_list").select("*").order("amount",{ascending:false}).range(from,to)),
  ]);
  const clients:SimpleClient[]=rawClients.map(c=>({id:c.id,name:`${c.first_name} ${c.last_name}`.trim(),archived:c.status==="archived" || !!c.deleted_at}));
  const packages=rawPackages.map(p=>({...p,price:Number(p.price)})) as SimplePackage[];
  const priceList:SimplePrice[]=prices.map(p=>({...p,amount:Number(p.amount)}));
  const rawPayments=cutoverDate ? await all((from,to)=>{let q=db.from("square_payments").select("square_payment_id,client_id,amount_cents,currency,status,created_at,raw_event,buyer_email").gte("created_at",`${cutoverDate}T00:00:00Z`).order("id");if(data.clientId)q=q.eq("client_id",data.clientId);return q.range(from,to);}) : [];
  const payments:SimplePayment[]=rawPayments.map(p=>{const event=p.raw_event as {data?:{object?:{payment?:{created_at?:string;buyer_email_address?:string;buyer_name?:string;billing_address?:{first_name?:string;last_name?:string}}}}}|null;const receipt=event?.data?.object?.payment;const address=receipt?.billing_address;const buyerName=receipt?.buyer_name??[address?.first_name,address?.last_name].filter(Boolean).join(" ");return {id:p.square_payment_id,clientId:p.client_id,amountCents:p.amount_cents,currency:p.currency,status:p.status??"",date:chicagoDate(receipt?.created_at??p.created_at),buyerName:buyerName||null,buyerEmail:p.buyer_email??receipt?.buyer_email_address??null};});
  const now=new Date().toISOString(); const bookings:SimpleBooking[]=[]; let bookingError:string|null=null;
  if(cutoverDate) {
    const token=process.env['SQUARE_PRODUCTION_ACCESS_TOKEN'];
    if(!token) bookingError="Square appointments unavailable";
    else {
      const customerMap=new Map(rawClients.filter(c=>c.square_customer_id).map(c=>[c.square_customer_id,c.id]));
      const earliest=[cutoverDate,...packages.filter(p=>!p.deleted_at).map(p=>p.started_on)].sort()[0]??cutoverDate;
      let start=new Date(`${earliest}T00:00:00Z`); const end=new Date(Date.now()+90*86400000);
      // Reuse production's GET reader, partitioning to keep its pagination cap from silently truncating visits.
      for(let windows=0;start<end;windows++) {
        if(windows>120) {bookingError="Appointment history is too large; manual review needed";break;}
        const next=new Date(Math.min(start.getTime()+28*86400000,end.getTime()));
        const result=await fetchSquareBookings(token,start.toISOString(),next.toISOString(),data.clientId?rawClients[0]?.square_customer_id??undefined:undefined);
        if(result.error || result.bookings.length>=2000) {bookingError=result.error??"Appointment history is incomplete";break;}
        for(const b of result.bookings) {const clientId=customerMap.get(b.customer_id??""); if(!clientId || !b.start_at) continue;
          const duration=(b.appointment_segments??[]).reduce((n,s)=>n+Number(s.duration_minutes??0),0);
          if(!duration && b.start_at<now) {bookingError="Some past appointments have no duration; visits need manual review";continue;}
          bookings.push({id:b.id,clientId,date:chicagoDate(b.start_at),startAt:b.start_at,endAt:new Date(new Date(b.start_at).getTime()+duration*60000).toISOString(),status:b.status??""});
        } start=next;
      }
    }
  }
  const board=computeSimpleDues({clients,packages,payments,bookings,openings:openings.map(o=>({client_id:o.client_id,amount:Number(o.amount)})),priceList,cutoverDate,now,bookingsReliable:!bookingError});
  return { ...board,clients,packages,openings:openings.map(o=>({...o,amount:Number(o.amount)})),priceList,cutoverDate,bookingError,computed_at:now,unlinkedPayments:unlinkedSimplePayments(payments,cutoverDate) };
});
export const simpleDuesQuery=(clientId?:string)=>queryOptions({queryKey:["simple-dues",clientId??"all"],queryFn:()=>getSimpleDues({data:clientId?{clientId}:{}}),staleTime:60000,refetchInterval:60000,refetchOnWindowFocus:true});

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(new Date(s).getTime()),"Invalid date");
export const previewSimpleOpeningPackages=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>z.object({cutoverDate:date}).parse(d)).handler(async({data,context})=>{
  const db=context.supabase;await admin(db,context.userId);
  const [clients,overrides,existing]=await Promise.all([
    all((from,to)=>db.from("clients").select("id,first_name,last_name,status,deleted_at,package_total_visits,package_price,package_start_date").order("id").range(from,to)),
    all((from,to)=>db.from("package_overrides").select("*").eq("slot","current").is("cleared_at",null).order("id").range(from,to)),
    all((from,to)=>db.from("simple_packages").select("client_id,source").eq("source","opening").order("id").range(from,to)),
  ]);
  return {...planOpeningPackages(clients,overrides as OpeningOverride[],existing as {client_id:string;source:"opening"}[],data.cutoverDate),cutoverDate:data.cutoverDate};
});
const amount=z.number().finite().min(0).max(9999999999).refine(n=>Math.round(n*100)/100===n,"Use at most two decimal places");
const packageFields={clientId:z.string().uuid(),visits:z.number().int().min(0).max(10000),price:amount,startedOn:date,note:z.string().max(2000)};
const mutation=z.discriminatedUnion("action",[
  z.object({action:z.literal("create-openings"),cutoverDate:date,rows:z.array(z.object({client_id:z.string().uuid(),visits:z.number().int().positive(),price:amount,started_on:date})).max(10000)}),
  z.object({action:z.literal("package"),id:z.string().uuid().optional(),...packageFields}),
  z.object({action:z.literal("remove"),id:z.string().uuid()}),z.object({action:z.literal("review"),id:z.string().uuid()}),
  z.object({action:z.literal("cutover"),date}),z.object({action:z.literal("price"),amount:amount.refine(n=>n>0),visits:z.number().int().positive().max(10000),flag:z.boolean()}),
  z.object({action:z.literal("remove-price"),amount}),z.object({action:z.literal("opening"),clientId:z.string().uuid(),amount:z.number().finite().min(-9999999999).max(9999999999),date,note:z.string().max(2000)}),
  z.object({action:z.literal("import"),csv:z.string().max(2000000),date}),z.object({action:z.literal("note"),clientId:z.string().uuid(),note:z.string().trim().min(1).max(2000)}),z.object({action:z.literal("sync")}),
]);
export type SimpleMutation=z.infer<typeof mutation>;
export const saveSimpleDues=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>mutation.parse(d)).handler(async({data,context})=>{
  const db=context.supabase; await admin(db,context.userId);
  let error:unknown=null;
  if(data.action==="create-openings") {const r=await db.rpc("simple_create_opening_packages",{_cutover:data.cutoverDate,_expected:data.rows});error=r.error;
  } else if(data.action==="package") {const row={client_id:data.clientId,visits:data.visits,price:data.price,started_on:data.startedOn,note:data.note};
    if(data.id) {const r=await db.from("simple_packages").update(row).eq("id",data.id).eq("client_id",data.clientId).is("deleted_at",null).select("id").single();error=r.error;}
    else {const r=await db.from("simple_packages").insert({...row,source:"manual",created_by:context.userId});error=r.error;}
  } else if(data.action==="review" || data.action==="remove") {const r=await db.from("simple_packages").update(data.action==="review"?{reviewed_at:new Date().toISOString(),reviewed_by:context.userId}:{deleted_at:new Date().toISOString()}).eq("id",data.id).is("deleted_at",null).select("id").single();error=r.error;
  } else if(data.action==="cutover") {
    const {count,error:countError}=await db.from("simple_price_list").select("amount",{count:"exact",head:true});if(countError)throw countError;
    if(!count) {const r=await db.from("simple_price_list").insert(SIMPLE_DEFAULT_PRICES);if(r.error)throw r.error;}
    const r=await db.from("simple_dues_settings").upsert({id:true,cutover_date:data.date});error=r.error;
  } else if(data.action==="price") {const r=await db.from("simple_price_list").upsert({amount:data.amount,visits:data.visits,flag_for_review:data.flag});error=r.error;
  } else if(data.action==="remove-price") {const r=await db.from("simple_price_list").delete().eq("amount",data.amount);error=r.error;
  } else if(data.action==="opening") {const r=await db.rpc("simple_import_openings",{_rows:[{client_id:data.clientId,amount:data.amount,note:data.note}],_as_of:data.date});error=r.error;
  } else if(data.action==="import") {const clients=await all((from,to)=>db.from("clients").select("id,first_name,last_name,status").order("id").range(from,to));
    const rows=parseOpeningCsv(data.csv,clients.map(c=>({id:c.id,name:`${c.first_name} ${c.last_name}`,archived:c.status==="archived"})));
    if(!rows.length)throw new Error("CSV is empty");const r=await db.rpc("simple_import_openings",{_rows:rows,_as_of:data.date});error=r.error;
  } else if(data.action==="note") {const r=await db.rpc("simple_payment_note",{_client_id:data.clientId,_note:data.note});error=r.error;
  } else if(data.action==="sync") {
    const {data:s,error:sError}=await db.from("simple_dues_settings").select("cutover_date").eq("id",true).maybeSingle();if(sError)throw sError;if(!s?.cutover_date)throw new Error("Set the cutover date first");
    const payments=await all((from,to)=>db.from("square_payments").select("square_payment_id").eq("status","COMPLETED").gte("created_at",`${s.cutover_date}T00:00:00Z`).order("id").range(from,to));
    for(const p of payments) {const r=await db.rpc("simple_record_payment",{_payment_id:p.square_payment_id});if(r.error)throw r.error;}
  }
  if(error)throw error;return {ok:true};
});