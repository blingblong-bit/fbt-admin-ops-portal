import { loadSquareBookingIndex } from "@/lib/effective-visit-state.server";
const t=process.env.SQUARE_ACCESS_TOKEN!;
const r = await fetch("https://connect.squareup.com/v2/customers/search",{method:"POST",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json","Square-Version":"2024-10-17"},body:JSON.stringify({query:{filter:{}},limit:100})});
let cursor; const all=[];
do { const rr=await fetch("https://connect.squareup.com/v2/customers?limit=100"+(cursor?`&cursor=${cursor}`:""),{headers:{Authorization:`Bearer ${t}`,"Square-Version":"2024-10-17"}}); const j=await rr.json(); all.push(...(j.customers??[])); cursor=j.cursor;} while(cursor);
const ps=all.filter(c=>/parish/i.test(c.family_name??"")||/parish/i.test(c.given_name??""));
console.log(ps.map(c=>[c.id,c.given_name,c.family_name,c.phone_number,c.email_address,c.created_at]));
const idx = await loadSquareBookingIndex(t, 180, 90);
for (const c of ps) for (const x of (idx.byCustomer.get(c.id)??[]).sort((a,b)=>a.start_at!.localeCompare(b.start_at!))) console.log(c.id.slice(0,6), x.start_at, x.status, JSON.stringify(x.seller_note), JSON.stringify(x.customer_note));
