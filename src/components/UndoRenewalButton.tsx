import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { undoLastRenewal } from "@/lib/admin-finance.functions";
import { invalidateFor } from "@/lib/invalidation";

/** Admin-only: audited undo of the last renewal. */
export function UndoRenewalButton({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const undo = useServerFn(undoLastRenewal);
  const m = useMutation({
    mutationFn: () => undo({ data: { clientId, reason } }),
    onSuccess: () => {
      toast.success("Renewal undone");
      invalidateFor(qc, ["payment-changed", "renewal-changed"], { clientId });
      onDone();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Undo last renewal</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo the last renewal?</DialogTitle>
            <DialogDescription>Puts back the package exactly as it was before the last renewal. This only works if no payments, visits or money edits happened since.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="undo-reason">Reason (saved in history)</Label>
          <Input id="undo-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()}>Undo renewal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
