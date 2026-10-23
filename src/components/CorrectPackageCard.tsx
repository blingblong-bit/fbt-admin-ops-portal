import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPackageEvidence, updateClientDetails } from "@/lib/admin-finance.functions";
import { preRenewNextPackage } from "@/lib/schedule.functions";
import { planCorrection, type CorrectionForm } from "@/lib/package-correction";
import { formatCurrency, type Client } from "@/lib/clients";
import { invalidateFor } from "@/lib/invalidation";

const d = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function initialForm(c: Client): CorrectionForm {
  return {
    package_total_visits: Number(c.package_total_visits ?? 0),
    visits_used: Number(c.visits_used ?? 0),
    package_price: Number(c.package_price ?? 0),
    amount_paid: Number(c.amount_paid ?? 0),
    package_start_date: c.package_start_date ?? null,
    renewal_start_date: c.pending_renewal_start_date ?? null,
    renewal_total_visits: c.pending_renewal_total_visits ?? null,
    renewal_price: c.pending_renewal_price ?? null,
  };
}

/** Admin-only: compare Hub package with Square evidence and correct through the existing logged edit steps. */
export function CorrectPackageCard({ client, onDone }: { client: Client; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Correct package</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Open correction</Button>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Compare this package with Square's appointment notes and payments, then fix it with a reason. Square is never changed.
      </CardContent>
      {open && <CorrectDialog client={client} onClose={() => setOpen(false)} onDone={onDone} />}
    </Card>
  );
}

function CorrectDialog({ client, onClose, onDone }: { client: Client; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const evidenceFn = useServerFn(getPackageEvidence);
  const saveDetails = useServerFn(updateClientDetails);
  const saveRenewal = useServerFn(preRenewNextPackage);
  const ev = useQuery({ queryKey: ["package-evidence", client.id], queryFn: () => evidenceFn({ data: { clientId: client.id } }) });
  const [form, setForm] = useState<CorrectionForm>(() => initialForm(client));
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const plan = useMemo(() => planCorrection(client as never, form), [client, form]);
  const hasRenewal = !!client.pending_renewal_start_date;

  const set = (k: keyof CorrectionForm, numeric = true) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: numeric ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value || null }));

  const save = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      if (Object.keys(plan.packagePatch).length) {
        await saveDetails({ data: { clientId: client.id, patch: plan.packagePatch, reason: `Package correction: ${reason.trim()}` } });
        done.push("package");
      }
      if (plan.renewal) {
        try {
          await saveRenewal({ data: { clientId: client.id, ...plan.renewal } });
          done.push("renewal");
        } catch (e) {
          throw new Error(`${done.length ? "Package was saved, but the renewal" : "Renewal"} change failed: ${(e as Error).message}`);
        }
      }
      return done;
    },
    onSuccess: () => {
      invalidateFor(qc, ["package-edited", "renewal-changed"], { clientId: client.id });
      toast.success("Correction saved and logged");
      onDone();
      onClose();
    },
    onError: (e) => {
      invalidateFor(qc, ["package-edited", "renewal-changed"], { clientId: client.id });
      toast.error((e as Error).message);
    },
  });

  const num = (label: string, k: keyof CorrectionForm, step = "1") => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={form[k] ?? ""} onChange={set(k)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct package — {client.first_name} {client.last_name}</DialogTitle>
          <DialogDescription>Each save goes through the existing logged edit steps. Nothing in Square changes and no texts are sent.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Current package (Hub)</h3>
            <div className="grid grid-cols-2 gap-2">
              {num("Package size (visits)", "package_total_visits")}
              {num("Visits used", "visits_used")}
              {num("Price", "package_price", "0.01")}
              {num("Paid on this package", "amount_paid", "0.01")}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Start date</Label>
                <Input type="date" value={form.package_start_date ?? ""} onChange={set("package_start_date", false)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Paid can only be lowered here. To add money, record a payment or use Move on an existing payment.
            </p>
            <h3 className="pt-2 text-sm font-semibold">Prepared renewal</h3>
            {hasRenewal ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Can start on or after</Label>
                  <Input type="date" value={form.renewal_start_date ?? ""} onChange={set("renewal_start_date", false)} />
                </div>
                {num("Size (visits)", "renewal_total_visits")}
                {num("Price", "renewal_price", "0.01")}
                <p className="col-span-2 text-xs text-muted-foreground">
                  Prepaid: {formatCurrency(Number(client.pending_renewal_paid ?? 0))} (change with Move on a payment). Cancel a renewal from the Renewal box above.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">None prepared.</p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Square appointment notes</h3>
            {ev.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading from Square…</p>
            ) : ev.error ? (
              <p className="text-xs text-destructive">{(ev.error as Error).message}</p>
            ) : (
              <>
                {ev.data?.squareError && <p className="text-xs text-amber-700">{ev.data.squareError}</p>}
                <ul className="max-h-56 divide-y overflow-y-auto rounded border text-xs">
                  {(ev.data?.bookings ?? []).map((b) => (
                    <li key={b.start_at} className="flex gap-2 px-2 py-1">
                      <span className="w-14 shrink-0 font-medium">{d(b.start_at)}</span>
                      <span className="w-20 shrink-0 text-muted-foreground">{b.status.toLowerCase().replace(/_/g, " ")}</span>
                      <span className="whitespace-pre-wrap">{b.note || "—"}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="text-sm font-semibold">Payments</h3>
                <ul className="divide-y rounded border text-xs">
                  {(ev.data?.payments ?? []).map((p, i) => (
                    <li key={p.ref || i} className="flex flex-wrap gap-2 px-2 py-1">
                      <span className="font-medium">{formatCurrency(p.amount)}</span>
                      <span>{d(p.at)}</span>
                      <span className={`rounded-full border px-1.5 ${p.source === "square" ? "border-primary/30 text-primary" : "border-amber-300 text-amber-800"}`}>
                        {p.source === "square" ? "Square payment" : "Hand-entered"}
                      </span>
                      <span className="text-muted-foreground">→ {p.where}</span>
                    </li>
                  ))}
                  {(ev.data?.payments ?? []).length === 0 && <li className="px-2 py-1 text-muted-foreground">None recorded.</li>}
                </ul>
              </>
            )}
          </section>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Before → after</h3>
          {plan.changes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="text-xs">
              {plan.changes.map((c) => (
                <li key={c.field}>{c.label}: <s className="text-muted-foreground">{show(c.before)}</s> → <strong>{show(c.after)}</strong></li>
              ))}
            </ul>
          )}
          {plan.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
          {Object.keys(plan.packagePatch).length > 0 && plan.renewal && (
            <p className="text-xs text-amber-700">Package and renewal save as two separate logged steps. If the second fails, the first stays saved and you'll be told.</p>
          )}
          <Label className="text-xs">Reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Square notes show 1 of 8 on Sep 14 and 8 of 8 on Oct 14" />
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={plan.changes.length === 0 || plan.errors.length > 0 || !reason.trim()} onClick={() => setConfirming(true)}>
            Review and save
          </Button>
        </DialogFooter>

        {confirming && (
          <Dialog open onOpenChange={(o) => !o && setConfirming(false)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save {plan.changes.length} change{plan.changes.length === 1 ? "" : "s"}?</DialogTitle>
                <DialogDescription>This updates the Hub only and is recorded in the timeline with your reason.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirming(false)}>Go back</Button>
                <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Confirm"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
