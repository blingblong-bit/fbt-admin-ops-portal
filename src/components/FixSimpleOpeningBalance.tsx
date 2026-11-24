import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { saveSimpleDues, type SimpleMutation } from "@/lib/simple-dues.functions";
import { invalidateFor } from "@/lib/simple-dues-cache";
import { formatCurrency } from "@/lib/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function FixSimpleOpeningBalance({clientId,name,opening}:{clientId:string;name:string;opening:{amount:number;as_of:string;note:string|null}}) {
  const {isAdmin}=useRole(); const [open,setOpen]=useState(false); const [amount,setAmount]=useState(String(opening.amount));
  const qc=useQueryClient(); const save=useServerFn(saveSimpleDues);
  const mutation=useMutation({mutationFn:(data:SimpleMutation)=>save({data}),onSuccess:async()=>{await invalidateFor(qc);setOpen(false);}});
  if(!isAdmin)return null;
  return <><Button size="sm" variant="outline" onClick={()=>{setAmount(String(opening.amount));mutation.reset();setOpen(true);}}><Pencil className="mr-1 size-4"/>Fix opening balance</Button>
    <Dialog open={open} onOpenChange={next=>{if(!mutation.isPending)setOpen(next);}}><DialogContent className="min-w-0"><DialogHeader className="min-w-0"><DialogTitle className="break-words pr-4">Fix opening balance · {name}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={e=>{e.preventDefault();const value=Number(amount);if(!Number.isFinite(value)||Math.round(value*100)/100!==value)return;if(window.confirm(`Change ${name}'s opening balance from ${formatCurrency(opening.amount)} to ${formatCurrency(value)}? Square payments and packages will stay unchanged.`))mutation.mutate({action:"opening",clientId,amount:value,date:opening.as_of,note:opening.note});}}>
        <div><Label htmlFor={`fix-opening-${clientId}`}>Opening balance ($)</Label><Input id={`fix-opening-${clientId}`} type="number" step="0.01" min="-9999999999" max="9999999999" required value={amount} onChange={e=>setAmount(e.target.value)}/></div>
        {opening.note&&<p className="break-words text-sm text-muted-foreground">{opening.note}</p>}
        {mutation.isError&&<p role="alert" className="text-sm text-destructive">Could not save opening balance.</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={mutation.isPending} onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={mutation.isPending}>Confirm opening balance</Button></div>
      </form>
    </DialogContent></Dialog>
  </>;
}