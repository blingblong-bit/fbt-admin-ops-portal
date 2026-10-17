import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listPaymentAllocations, reallocatePayment, undoLastRenewal } from "@/lib/admin-finance.functions";
import { BUCKETS, BUCKET_LABEL, planMove, type Bucket, type PaymentStatus } from "@/lib/payment-allocation";
import { formatCurrency, type Client } from "@/lib/clients";

/** Admin-only: where each payment's money sits, safe moves, and renewal undo. */
export function PaymentAllocationsCard({ client, onDone }: { client: Client; onDone: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listPaymentAllocations);
  const q = useQuery({
    queryKey: ["payment-allocations", client.id],
    queryFn: () => list({ data: { clientId: client.id } }),
  });
  const [moving, setMoving] = useState<PaymentStatus | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payment-allocations", client.id] });
    qc.invalidateQueries({ queryKey: ["master-dues"] });
    onDone();
  };

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Payments and where they went</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setUndoOpen(true)}>
          Undo last renewal
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <ul className="divide-y">
            {(q.data ?? []).map((p) => (
              <li key={p.ref} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="font-medium">
                    {formatCurrency(p.amount)} · {new Date(p.at).toLocaleDateString()} ·{" "}
                    <span className="text-xs text-muted-foreground">…{p.ref.slice(-6)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.split
                      ? BUCKETS.filter((b) => p.split![b] !== 0)
                          .map((b) => `${BUCKET_LABEL[b]} ${formatCurrency(p.split![b])}`)
                          .join(" · ") || "—"
                      : "Split unknown"}
                  </div>
                  {p.reason && <div className="text-xs text-amber-700">{p.reason}</div>}
                </div>
                <Button size="sm" variant="outline" disabled={!p.movable} onClick={() => setMoving(p)}>
                  Move
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {moving && <MoveDialog client={client} payment={moving} onClose={() => setMoving(null)} onDone={refresh} />}
      <UndoRenewalDialog open={undoOpen} client={client} onClose={() => setUndoOpen(false)} onDone={refresh} />
    </Card>
  );
}

function MoveDialog({ client, payment, onClose, onDone }: { client: Client; payment: PaymentStatus; onClose: () => void; onDone: () => void }) {
  const split = payment.split!;
  const firstFrom = BUCKETS.find((b) => split[b] > 0) ?? "current";
  const [from, setFrom] = useState<Bucket>(firstFrom);
  const [to, setTo] = useState<Bucket>(firstFrom === "current" ? (client.pending_renewal_start_date ? "pending" : "previous") : "current");
  const [amount, setAmount] = useState(split[firstFrom]);
  const [reason, setReason] = useState("");
  const move = useServerFn(reallocatePayment);
  const plan = planMove(split, client, from, to, Number(amount));
  const m = useMutation({
    mutationFn: () => move({ data: { clientId: client.id, paymentRef: payment.ref, from, to, amount: Number(amount), reason } }),
    onSuccess: () => {
      toast.success("Payment moved");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sel = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move part of this {formatCurrency(payment.amount)} payment</DialogTitle>
          <DialogDescription>The payment and its total stay the same. Only where its money counts changes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="mv-from">From</Label>
          <select id="mv-from" aria-label="Move from" className={sel} value={from} onChange={(e) => setFrom(e.target.value as Bucket)}>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b]} ({formatCurrency(split[b])} of this payment)
              </option>
            ))}
          </select>
          <Label htmlFor="mv-to">To</Label>
          <select id="mv-to" aria-label="Move to" className={sel} value={to} onChange={(e) => setTo(e.target.value as Bucket)}>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b]}
              </option>
            ))}
          </select>
          <Label htmlFor="mv-amt">Amount ($)</Label>
          <Input id="mv-amt" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <Label htmlFor="mv-reason">Reason (saved in history)</Label>
          <Input id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          {plan.ok ? (
            <p className="text-xs text-muted-foreground">
              After: previous package owes {formatCurrency(plan.client.previous_package_owed)} · current paid{" "}
              {formatCurrency(plan.client.amount_paid)} · prepared renewal paid {formatCurrency(plan.client.pending_renewal_paid)}
            </p>
          ) : (
            <p className="text-xs text-destructive">{plan.error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!plan.ok || !reason.trim() || m.isPending} onClick={() => m.mutate()}>
            Move payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndoRenewalDialog({ open, client, onClose, onDone }: { open: boolean; client: Client; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const undo = useServerFn(undoLastRenewal);
  const m = useMutation({
    mutationFn: () => undo({ data: { clientId: client.id, reason } }),
    onSuccess: () => {
      toast.success("Renewal undone");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo the last renewal?</DialogTitle>
          <DialogDescription>
            Puts back the package exactly as it was before the last renewal. This only works if no payments, visits or money edits happened since. Otherwise the renewal needs review.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="undo-reason">Reason (saved in history)</Label>
        <Input id="undo-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()}>
            Undo renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
