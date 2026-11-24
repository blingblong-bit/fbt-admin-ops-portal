import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveSimpleDues } from "@/lib/simple-dues.functions";
import { chicagoDate, type SimpleClient, type SimplePackage } from "@/lib/simple-dues";
import { invalidateFor } from "@/lib/simple-dues-cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type SimpleFormRequest={clientId:string; initial?:SimplePackage; edit?:boolean};
export function SimplePackageForm({clients,request,onClose}:{clients:SimpleClient[];request:SimpleFormRequest;onClose:()=>void}) {
  const [clientId,setClientId]=useState(request.clientId);
  const [visits,setVisits]=useState(String(request.initial?.visits??8));
  const [price,setPrice]=useState(String(request.initial?.price??375));
  const [start,setStart]=useState(request.edit?request.initial?.started_on??chicagoDate(new Date()):chicagoDate(new Date()));
  const [note,setNote]=useState(request.edit?request.initial?.note??"":"");
  const qc=useQueryClient();const save=useServerFn(saveSimpleDues);
  const mutation=useMutation({mutationFn:()=>save({data:{action:"package",clientId,visits:Number(visits),price:Number(price),startedOn:start,note,...(request.edit&&request.initial?{id:request.initial.id}:{})}}),onSuccess:async()=>{await invalidateFor(qc);onClose();}});
  return <Dialog open onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>{request.edit?"Edit simple package":"Add simple package"}</DialogTitle></DialogHeader>
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();mutation.mutate();}}>
      <div><Label htmlFor="simple-client">Client</Label><select id="simple-client" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={clientId} onChange={e=>setClientId(e.target.value)} disabled={!!request.clientId} required><option value="">Select client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}{c.archived?" (archived)":""}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="simple-visits">Visits</Label><Input id="simple-visits" type="number" min="0" max="10000" step="1" required value={visits} onChange={e=>setVisits(e.target.value)}/></div><div><Label htmlFor="simple-price">Price ($)</Label><Input id="simple-price" type="number" min="0" step="0.01" required value={price} onChange={e=>setPrice(e.target.value)}/></div></div>
      <div><Label htmlFor="simple-start">Start date</Label><Input id="simple-start" type="date" required value={start} onChange={e=>setStart(e.target.value)}/></div>
      <div><Label htmlFor="simple-note">Note</Label><Textarea id="simple-note" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></div>
      {mutation.isError&&<p role="alert" className="text-sm text-destructive">{mutation.error instanceof Error?mutation.error.message:"Could not save package"}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !clientId}>{mutation.isPending?"Saving…":"Save package"}</Button></div>
    </form></DialogContent></Dialog>;
}