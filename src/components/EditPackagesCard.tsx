import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clearPackageOverride, listPackageOverrides, setPackageOverride } from "@/lib/admin-finance.functions";
import { applyOverrides } from "@/lib/package-override";
import { formatCurrency, type Client } from "@/lib/clients";
import { invalidateFor } from "@/lib/invalidation";

type Form = { total_visits: string; visits_used: string; price: string; recognized_paid: string };
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Admin-only plain package edit. Pre-filled with the current effective values;
 * saving writes only the "current" slot through the audited set_package_override.
 * Square payments and raw client fields are never changed.
 */
export function EditPackagesCard({ client, onDone, editRequest }: { client: Client; onDone: () => void; editRequest?: { key: number } | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPackageOverrides);
  const setFn = useServerFn(setPackageOverride);
  const clearFn = useServerFn(clearPackageOverride);
  const q = useQuery({ queryKey: ["package-overrides", client.id], queryFn: () => listFn({ data: { clientId: client.id } }) });
  const overrides = q.data ?? [];
  const current = overrides.find((o) => o.slot === "current");
  const eff = applyOverrides(client as never, overrides) as unknown as Client;
  const fresh = (): Form => ({ total_visits: s(eff.package_total_visits), visits_used: s(eff.visits_used), price: s(eff.package_price), recognized_paid: s(eff.amount_paid) });
  const [form, setForm] = useState<Form | null>(null);
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (q.data && (!form || (editRequest && seen.current !== editRequest.key))) {
      if (editRequest) { seen.current = editRequest.key; ref.current?.scrollIntoView({ block: "start" }); }
      setForm(fresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, editRequest]);
  const done = () => { invalidateFor(qc, "package-edited", { clientId: client.id }); onDone(); setReason(""); };

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Still loading");
      const values = {
        total_visits: num(form.total_visits), visits_used: num(form.visits_used), price: num(form.price), recognized_paid: num(form.recognized_paid),
        start_date: current?.start_date ?? eff.package_start_date ?? null, status: "active",
      };
      return setFn({ data: { clientId: client.id, slot: "current", values, reason } });
    },
    onSuccess: (r) => { toast.success(r.changed ? "Package saved" : "No changes — already saved"); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: () => clearFn({ data: { clientId: client.id, slot: "current", reason } }),
    onSuccess: () => { toast.success("Edit cleared — automatic tracking resumed"); done(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (k: keyof Form, label: string) => form && (
    <div className="space-y-1">
      <Label htmlFor={`package-${k}`} className="text-xs">{label}</Label>
      <Input id={`package-${k}`} type="number" min={0} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );
  const owes = form ? Math.max(0, Number(num(form.price) ?? 0) - Number(num(form.recognized_paid) ?? 0)) : 0;

  return (
    <Card ref={ref} className="lg:col-span-3">
      <CardHeader><CardTitle>Edit package</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!form ? <p className="text-muted-foreground">Loading…</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {field("total_visits", "Package size")}
              {field("price", "Price")}
              {field("visits_used", "Visits used")}
              {field("recognized_paid", "Amount paid")}
            </div>
            <p>Current package owes: <strong>{formatCurrency(owes)}</strong></p>
            <div className="space-y-1">
              <Label htmlFor="package-reason" className="text-xs">Reason (required)</Label>
              <Textarea id="package-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!reason.trim() || save.isPending} onClick={() => save.mutate()}>Save</Button>
              {current && <Button variant="outline" disabled={!reason.trim() || clear.isPending} onClick={() => clear.mutate()}>Clear edit</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Saved as an audited admin edit. Square payments are never changed.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
