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

export function SimpleDuesCard({clientId}:{clientId:string}) {
  const {isAdmin}=useRole();const q=useQuery(simpleDuesQuery(clientId));const [request,setRequest]=useState<SimpleFormRequest|null>(null);
  const qc=useQueryClient();const save=useServerFn(saveSimpleDues);const mutation=useMutation({mutationFn:(data:SimpleMutation)=>save({data}),onSuccess:()=>invalidateFor(qc)});
  const row=q.data?.rows[0];
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle className="text-base">Dues (simple)</CardTitle>{isAdmin&&<Button size="sm" variant="outline" disabled={!q.data} onClick={()=>setRequest({clientId})}><Plus className="mr-1 size-4"/>Add package</Button>}</CardHeader><CardContent>
    <DuesFreshnessBanner q={q}/>
    {q.isPending?<p className="text-sm text-muted-foreground">Loading…</p>:q.isError?<p role="alert" className="text-sm text-destructive">Simple dues could not load.</p>:<>
    <p className="mb-3 text-lg font-semibold">{row?.balance===null||!q.data?.cutoverDate?"Cutover not set":`Balance ${formatCurrency(row?.balance??0)}`}</p>
    {q.data?.bookingError&&<p className="mb-2 text-sm text-destructive">Visits unavailable — manual review needed.</p>}
    {row?.visitsLeft!==null && row?.visitsLeft!==undefined&&<p className="mb-2 text-sm text-muted-foreground">{row.visitsLeft<0?`${Math.abs(row.visitsLeft)} visits over`:`${row.visitsLeft} visits left across recorded packages`}</p>}
    {!!row?.upcomingVisits.length&&<div className="mb-4"><h3 className="mb-1 text-sm font-semibold">Upcoming visits</h3><ul className="space-y-1 text-sm">{row.upcomingVisits.slice(0,5).map(v=><li key={v.booking.id} className="flex flex-wrap gap-x-1"><span>{new Date(v.booking.startAt).toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric'})} ·</span><span className={v.newPackage?'font-semibold':'text-muted-foreground'}>{v.label}{v.newPackage?` new package (${formatCurrency(v.price)})`:''}</span></li>)}</ul></div>}
    {!q.data?.packages.length&&<p className="text-sm text-muted-foreground">No simple packages</p>}
    <ul className="divide-y">{q.data?.packages.slice().sort((a,b)=>b.started_on.localeCompare(a.started_on)).map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className={p.deleted_at?"text-sm line-through text-muted-foreground":"text-sm font-medium"}>{p.visits} visits · {formatCurrency(p.price)} · {formatDate(p.started_on)}</p><p className="text-xs text-muted-foreground">{p.deleted_at?"Removed":p.source}{p.flagged_for_review&&!p.reviewed_at&&!p.deleted_at?" · Needs review":""}{p.note?` · ${p.note}`:""}</p></div>{isAdmin&&!p.deleted_at&&<div className="flex gap-1"><Button size="icon" variant="ghost" title="Edit package" aria-label="Edit package" onClick={()=>setRequest({clientId,initial:p,edit:true})}><Pencil className="size-4"/></Button><Button size="icon" variant="ghost" title="Remove package" aria-label="Remove package" disabled={mutation.isPending} onClick={()=>{if(window.confirm("Remove this simple package? Its history and Square payment remain recorded."))mutation.mutate({action:"remove",id:p.id});}}><Trash2 className="size-4"/></Button></div>}</li>)}</ul></>}
    {mutation.isError&&<p role="alert" className="text-sm text-destructive">Could not save change.</p>}
    {request&&q.data&&<SimplePackageForm clients={q.data.clients} request={request} onClose={()=>setRequest(null)}/>}
  </CardContent></Card>;
}