import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearPackageOverride, listPackageOverrides, setPackageOverride } from "@/lib/admin-finance.functions";
import { applyOverrides, needsConfirmation, type OverrideSlot, type OverrideStatus, type PackageOverride } from "@/lib/package-override";
import { formatCurrency, type Client } from "@/lib/clients";
import { invalidateFor } from "@/lib/invalidation";

const SLOTS: { slot: OverrideSlot; label: string }[] = [
  { slot: "current", label: "Current package" },
  { slot: "pending", label: "Prepared renewal" },
  { slot: "previous", label: "Prior package" },
];

type Form = { total_visits: string; visits_used: string; price: string; recognized_paid: string; start_date: string; status: OverrideStatus };
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function startForm(c: Client, slot: OverrideSlot, o?: PackageOverride): Form {
  if (o) return { total_visits: s(o.total_visits), visits_used: s(o.visits_used), price: s(o.price), recognized_paid: s(o.recognized_paid), start_date: s(o.start_date), status: o.status };
  if (slot === "current") return { total_visits: s(c.package_total_visits), visits_used: s(c.visits_used), price: s(c.package_price), recognized_paid: s(c.amount_paid), start_date: s(c.package_start_date), status: "active" };
  if (slot === "pending") return { total_visits: s(c.pending_renewal_total_visits), visits_used: "0", price: s(c.pending_renewal_price), recognized_paid: s(c.pending_renewal_paid), start_date: s(c.pending_renewal_start_date), status: "prepared" };
  return { total_visits: "", visits_used: "", price: s(c.previous_package_owed), recognized_paid: "0", start_date: "", status: "completed" };
}
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Admin-only: set admin-authoritative package figures. Never changes the Square payment ledger. */
export function EditPackagesCard({ client, onDone }: { client: Client; onDone: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPackageOverrides);
  const setFn = useServerFn(setPackageOverride);
  const clearFn = useServerFn(clearPackageOverride);
  const q = useQuery({ queryKey: ["package-overrides", client.id], queryFn: () => listFn({ data: { clientId: client.id } }) });
  const overrides = q.data ?? [];
  const eff = applyOverrides(client as never, overrides) as unknown as Client & { override_flags: string[] };
  const [slot, setSlot] = useState<OverrideSlot | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [reason, setReason] = useState("");
  const current = slot ? overrides.find((o) => o.slot === slot) : undefined;

  const open = (sl: OverrideSlot) => { setSlot(sl); setForm(startForm(client, sl, overrides.find((o) => o.slot === sl))); setReason(""); };
  const close = () => { setSlot(null); setForm(null); };
  const done = () => { invalidateFor(qc, "package-edited", { clientId: client.id }); onDone(); close(); };

  const save = useMutation({
    mutationFn: () => {
      const values = { total_visits: num(form!.total_visits), visits_used: num(form!.visits_used), price: num(form!.price), recognized_paid: num(form!.recognized_paid), start_date: form!.start_date || null, status: form!.status };
      if (needsConfirmation(current ?? startForm(client, slot!) as never, { slot: slot!, ...values } as PackageOverride)
        && !window.confirm("This changes the paid amount or package status that Payment Due uses. Save?")) throw new Error("cancelled");
      return setFn({ data: { clientId: client.id, slot: slot!, values, reason } });
    },
    onSuccess: (r) => { toast.success(r.changed ? "Package override saved" : "No changes — already saved"); done(); },
    onError: (e: Error) => { if (e.message !== "cancelled") toast.error(e.message); },
  });
  const clear = useMutation({
    mutationFn: () => clearFn({ data: { clientId: client.id, slot: slot!, reason } }),
    onSuccess: () => { toast.success("Override cleared — automatic tracking resumed"); done(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const owed = form ? Math.max(0, Number(num(form.price) ?? 0) - Number(num(form.recognized_paid) ?? 0)) : 0;
  const f = (k: keyof Form, label: string, type = "number") => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={form![k]} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} />
    </div>
  );

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Edit packages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {SLOTS.map(({ slot: sl, label }) => (
            <Button key={sl} size="sm" variant="outline" onClick={() => open(sl)}>
              {label}{overrides.some((o) => o.slot === sl) && <Badge variant="secondary" className="ml-2">Override</Badge>}
            </Button>
          ))}
        </div>
        {overrides.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            <p className="font-medium">Admin override active — Hub uses these figures and automatic renewal is paused for this client.</p>
            <p>Current: {eff.visits_used ?? 0}/{eff.package_total_visits ?? 0} visits · {formatCurrency(Number(eff.package_price ?? 0))} price · {formatCurrency(Number(eff.amount_paid ?? 0))} recognized paid</p>
            {eff.override_flags.map((m) => <p key={m} className="text-muted-foreground">Review (not blocking): {m}</p>)}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Recognized paid is an admin figure, not a payment. Square payments are never changed.</p>
      </CardContent>

      <Dialog open={!!slot} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{SLOTS.find((x) => x.slot === slot)?.label}</DialogTitle>
            <DialogDescription>{current ? "Override active. Edit or clear it." : "Saving creates an admin override."}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid grid-cols-2 gap-3">
              {slot !== "previous" && f("total_visits", "Package size")}
              {slot !== "previous" && f("visits_used", "Visits used")}
              {f("price", "Price")}
              {f("recognized_paid", "Recognized paid (override)")}
              {slot !== "previous" && f("start_date", "Start date", "date")}
              {slot !== "previous" && (
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <select className="h-9 w-full rounded-md border bg-background px-2" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as OverrideStatus })}>
                    {slot === "pending" ? <><option value="prepared">Prepared</option><option value="active">Active (started)</option></> : <><option value="active">Active</option><option value="completed">Completed</option></>}
                  </select>
                </div>
              )}
              <p className="col-span-2 text-sm">Owed: <strong>{formatCurrency(owed)}</strong></p>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Reason (required)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {current && <Button variant="outline" disabled={!reason.trim() || clear.isPending} onClick={() => clear.mutate()}>Clear override</Button>}
            <Button disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
