import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preRenewNextPackage, cancelPendingRenewal } from "@/lib/schedule.functions";
import { renewPackage } from "@/lib/renewal.functions";
import { getProfileRenewal } from "@/lib/profile-renewal.functions";
import { invalidateFor } from "@/lib/invalidation";
import { nextPackagePrefill, nextPackageLine, chicagoToday, startsNow, type NextPackagePrefill } from "@/lib/profile-renewal";

export function ProfileUpcomingRenewal({ clientId, isAdmin }: { clientId: string; isAdmin: boolean }) {
  const fn = useServerFn(getProfileRenewal);
  const q = useQuery({ queryKey: ["client", clientId, "upcoming-renewal"], queryFn: () => fn({ data: { clientId } }), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const p = q.data ? nextPackagePrefill(q.data.renewal, q.data.current ?? null) : null;
  const line = q.isLoading ? "Next package: loading…" : q.isError ? "Next package: unavailable" : nextPackageLine(p);
  return (
    <section aria-label="Next package" className="border-b pb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{line}</p>
        {isAdmin && !open && !q.isLoading && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Renew</Button>}
      </div>
      {isAdmin && open && <RenewForm clientId={clientId} p={p} packageName={q.data?.current?.packageName ?? null} onClose={() => setOpen(false)} />}
    </section>
  );
}

function RenewForm({ clientId, p, packageName, onClose }: { clientId: string; p: NextPackagePrefill | null; packageName: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const renew = useServerFn(renewPackage);
  const prep = useServerFn(preRenewNextPackage);
  const cancel = useServerFn(cancelPendingRenewal);
  const [visits, setVisits] = useState(p?.visits != null ? String(p.visits) : "");
  const [price, setPrice] = useState(p?.price != null ? String(p.price) : "");
  const [start, setStart] = useState(p?.startYmd ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(visits), pr = Number(price);
      if (!Number.isInteger(n) || n < 1) throw new Error("Enter visits");
      if (!Number.isFinite(pr) || pr <= 0) throw new Error("Enter price");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("Enter start date");
      if (startsNow(start, chicagoToday())) {
        await renew({ data: { clientId, packageName, totalVisits: n, price: pr, startDate: start, paidNow: 0 } });
        return "now" as const;
      }
      await prep({ data: { clientId, startYmd: start, price: pr, totalVisits: n } });
      return "later" as const;
    },
    onSuccess: (k) => {
      toast.success(k === "now" ? "New package started" : "Next package saved");
      invalidateFor(qc, "renewal-changed", { clientId });
      if (k === "now") invalidateFor(qc, "payment-changed", { clientId });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => cancel({ data: { clientId } }),
    onSuccess: () => { toast.success("Next package removed"); invalidateFor(qc, "renewal-changed", { clientId }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = save.isPending || remove.isPending;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Visits<Input aria-label="Visits" type="number" min={1} className="h-9 w-20" value={visits} onChange={(e) => setVisits(e.target.value)} /></label>
      <label className="text-xs">Price<Input aria-label="Price" type="number" min={0} step="0.01" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="text-xs">Start date<Input aria-label="Start date" type="date" className="h-9 w-40" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <Button size="sm" disabled={busy} onClick={() => save.mutate()}>Save</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
      {p?.hasPrepared && <button type="button" className="text-xs text-muted-foreground underline" disabled={busy} onClick={() => remove.mutate()}>Remove</button>}
      {remove.error && <p className="w-full text-xs text-destructive">{(remove.error as Error).message}</p>}
    </div>
  );
}
