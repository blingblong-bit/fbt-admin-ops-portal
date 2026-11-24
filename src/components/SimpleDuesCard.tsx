import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { simpleDuesQuery, saveSimpleDues, type SimpleMutation } from "@/lib/simple-dues.functions";
import { invalidateFor } from "@/lib/simple-dues-cache";
import { formatCurrency, formatDate } from "@/lib/clients";
import { SimplePackageForm, type SimpleFormRequest } from "./SimplePackageForm";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DuesFreshnessBanner } from "./DuesFreshnessBanner";
import { FixSimpleOpeningBalance } from "./FixSimpleOpeningBalance";

export function SimpleDuesCard({clientId,view="summary"}:{clientId:string;view?:"summary"|"history"}) {
  const {isAdmin}=useRole();const q=useQuery(simpleDuesQuery(clientId));const [request,setRequest]=useState<SimpleFormRequest|null>(null);
  const qc=useQueryClient();const save=useServerFn(saveSimpleDues);const mutation=useMutation({mutationFn:(data:SimpleMutation)=>save({data}),onSuccess:()=>invalidateFor(qc)});
  const row=q.data?.rows[0];const summary=q.data?.packageSummaries[clientId];const current=summary?.package;
  const packages=q.data?.packages.slice().sort((a,b)=>b.started_on.localeCompare(a.started_on)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))??[];
  const [showAll,setShowAll]=useState(false);
  const payments=[...new Map([...(q.data?.paymentHistory??[]),...(q.data?.payments??[])].filter(p=>p.status==="COMPLETED").map(p=>[p.id,p])).values()].sort((a,b)=>b.date.localeCompare(a.date)||("paidAt" in b?String(b.paidAt):b.date).localeCompare("paidAt" in a?String(a.paidAt):a.date)||b.id.localeCompare(a.id));
  const lastPayment=q.data?.lastPayments[clientId];const opening=q.data?.openings.find(o=>o.client_id===clientId);
  return <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{view==="summary"?"Dues (simple)":"Simple packages"}</CardTitle>{view==="history"&&isAdmin&&<Button size="sm" variant="outline" disabled={!q.data} onClick={()=>setRequest({clientId})}><Plus className="mr-1 size-4"/>Add package</Button>}</CardHeader><CardContent>
    <DuesFreshnessBanner q={q}/>
    {q.isPending?<p className="text-sm text-muted-foreground">Loading…</p>:q.isError?<p role="alert" className="text-sm text-destructive">Simple dues could not load.</p>:<>
    {view==="summary"?<>
      <p className="mb-4 text-lg font-semibold">{!q.data?.cutoverDate?"Cutover not set":row?.balance===undefined||row.balance===null?"Balance unavailable":`Balance ${formatCurrency(row.balance)}`}</p>
      <p className="mb-3 text-sm text-muted-foreground">{lastPayment?`Last payment: ${formatCurrency(lastPayment.amount)} on ${formatDate(lastPayment.date)}`:"No Square payments found"}</p>
      <div className="mb-4 space-y-2 border-y py-3"><p className="text-sm">Opening balance (carried from old Hub): <strong>{formatCurrency(opening?.amount??0)}</strong></p>{opening?.note&&<p className="break-words text-xs text-muted-foreground">{opening.note}</p>}{opening&&<FixSimpleOpeningBalance clientId={clientId} name={q.data?.clients[0]?.name??"Client"} opening={opening}/>}</div>
      {q.data?.bookingError&&<p className="mb-2 text-sm text-destructive">Visits unavailable — manual review needed.</p>}
      {current?<dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Current simple package</dt><dd className="font-medium">{current.visits} visits · {formatCurrency(current.price)}</dd></div><div><dt className="text-muted-foreground">Started</dt><dd>{formatDate(current.started_on)}</dd></div><div><dt className="text-muted-foreground">Visits left</dt><dd className="font-semibold">{summary?.visitsLeft}/{summary?.totalVisits??current.visits}</dd></div><div><dt className="text-muted-foreground">Next 1/x</dt><dd>{summary?.nextStart?`${summary.nextStart.label} · ${formatDate(summary.nextStart.booking.date)}`:"Not scheduled"}</dd></div></dl>:<p className="text-sm text-muted-foreground">{q.data?.bookingError?"Current package progress unavailable":"No simple packages"}</p>}
      {!!row?.upcomingVisits.length&&<div className="mt-4"><h3 className="mb-1 text-sm font-semibold">Upcoming visits</h3><ul className="space-y-1 text-sm">{row.upcomingVisits.slice(0,5).map(v=><li key={v.booking.id} className="flex flex-wrap gap-x-1"><span>{new Date(v.booking.startAt).toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric'})} ·</span><span className={v.newPackage?'font-semibold':'text-muted-foreground'}>{v.label}{v.newPackage?` new package (${formatCurrency(v.price)})`:''}</span></li>)}</ul></div>}
    </>:<>
      {!packages.length&&<p className="text-sm text-muted-foreground">No simple packages</p>}
      <ul className="divide-y">{packages.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className={p.deleted_at?"text-sm line-through text-muted-foreground":"text-sm font-medium"}>{p.visits} visits · {formatCurrency(p.price)} · {formatDate(p.started_on)}</p><p className="break-words text-xs text-muted-foreground">{p.deleted_at?"Removed":p.source}{p.flagged_for_review&&!p.reviewed_at&&!p.deleted_at?" · Needs review":""}{p.note?` · ${p.note}`:""}</p></div>{isAdmin&&!p.deleted_at&&<div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={()=>setRequest({clientId,initial:p,edit:true})}><Pencil className="mr-1 size-4"/>Change</Button><Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={()=>{if(window.confirm("Remove this simple package? Its history and Square payment remain recorded."))mutation.mutate({action:"remove",id:p.id});}}><Trash2 className="mr-1 size-4"/>Remove</Button></div>}</li>)}</ul>
    </>}
    <section className="mt-5 border-t pt-4"><h3 className="mb-2 text-sm font-semibold">Payment history</h3>{!payments.length?<p className="text-sm text-muted-foreground">No Square payments found</p>:<><ul className="divide-y">{(showAll?payments:payments.slice(0,10)).map(p=><li key={p.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p>{formatDate(p.date)}</p>{q.data?.cutoverDate&&p.date<q.data.cutoverDate&&<span className="text-xs text-muted-foreground">Before cutover · not in balance</span>}</div><span className="tabular-nums">{new Intl.NumberFormat("en-US",{style:"currency",currency:p.currency}).format(p.amountCents/100)}</span></li>)}</ul>{payments.length>10&&<Button size="sm" variant="ghost" onClick={()=>setShowAll(v=>!v)}>{showAll?"Show less":"Show all"}</Button>}</>}</section>
    </>}
    {mutation.isError&&<p role="alert" className="text-sm text-destructive">Could not save change.</p>}
    {request&&q.data&&<SimplePackageForm clients={q.data.clients} request={request} onClose={()=>setRequest(null)}/>}
  </CardContent></Card>;
}
