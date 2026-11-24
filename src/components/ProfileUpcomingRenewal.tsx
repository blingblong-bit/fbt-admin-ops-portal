import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preRenewNextPackage, cancelPendingRenewal } from "@/lib/schedule.functions";
import { getProfileRenewal } from "@/lib/profile-renewal.functions";
import { invalidateFor } from "@/lib/invalidation";
import type { PreparedInfo } from "@/lib/upcoming-first-visit";

const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function ProfileUpcomingRenewal({ clientId, isAdmin }: { clientId: string; isAdmin: boolean }) {
  const fn = useServerFn(getProfileRenewal);
  const q = useQuery({ queryKey: ["client", clientId, "upcoming-renewal"], queryFn: () => fn({ data: { clientId } }), staleTime: 60_000 });
  const r = q.data?.renewal;
  let body: React.ReactNode;
  if (q.isLoading) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (q.isError || q.data?.error || !r) body = <p className="text-sm text-muted-foreground">Upcoming renewal unavailable — try again shortly.</p>;
  else if (r.kind === "none") body = <p className="text-sm text-muted-foreground">No 1/x booked yet.</p>;
  else if (r.kind === "upcoming" && r.item.status === "needs_review") body = <NeedsReview clientId={clientId} isAdmin={isAdmin} ymd={r.item.ymd} total={r.item.total_visits} price={r.item.price} prepared={r.prepared} />;
  else {
    const p = r.prepared!;
    const line = r.kind === "upcoming"
      ? `1/${r.item.total_visits} on ${day(r.item.ymd)} · ${p.price != null ? $(p.price) : "price needed"}`
      : `Prepared: ${p.totalVisits ?? "?"} visits · ${p.price != null ? $(p.price) : "price needed"} · starts ${p.startYmd ? day(p.startYmd) : "—"}`;
    const status = r.kind === "upcoming" ? `Approved · due ${day(r.item.ymd)}, not owed yet` : "Prepared · no 1/x booked yet, not owed yet";
    body = <Prepared clientId={clientId} isAdmin={isAdmin} line={line} status={status} prepared={p} />;
  }
  return <section aria-label="Upcoming renewal" className="border-b pb-4"><h2 className="mb-1 text-lg font-semibold">Upcoming renewal</h2>{body}</section>;
}

function NeedsReview({ clientId, isAdmin, ymd, total, price, prepared }: { clientId: string; isAdmin: boolean; ymd: string; total: number; price: number | null; prepared: PreparedInfo | null }) {
  const qc = useQueryClient();
  const prep = useServerFn(preRenewNextPackage);
  const [val, setVal] = useState(price != null ? String(price) : "");
  const ok = useMutation({
    mutationFn: () => {
      const p = Number(val);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Enter the package price first");
      return prep({ data: { clientId, startYmd: ymd, price: p, totalVisits: total } });
    },
    onSuccess: () => { toast.success("Approved — owed once the 1/x visit starts"); invalidateFor(qc, "renewal-changed", { clientId }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="text-sm">1/{total} on {day(ymd)} · {price != null ? $(price) : "price needed"}</div>
        <div className="text-xs text-muted-foreground">Needs review{prepared ? " · a different prepared renewal exists and will be replaced" : ""}</div>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Input aria-label="Renewal price" type="number" min={0} step="0.01" className="h-9 w-28" value={val} onChange={(e) => setVal(e.target.value)} />
          <Button size="sm" disabled={ok.isPending} onClick={() => ok.mutate()}>OK</Button>
        </div>
      )}
    </div>
  );
}

function Prepared({ clientId, isAdmin, line, status, prepared }: { clientId: string; isAdmin: boolean; line: string; status: string; prepared: PreparedInfo }) {
  const qc = useQueryClient();
  const prep = useServerFn(preRenewNextPackage);
  const cancel = useServerFn(cancelPendingRenewal);
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(prepared.price != null ? String(prepared.price) : "");
  const [size, setSize] = useState(prepared.totalVisits != null ? String(prepared.totalVisits) : "");
  const [start, setStart] = useState(prepared.startYmd ?? "");
  const done = (msg: string) => { toast.success(msg); setEditing(false); invalidateFor(qc, "renewal-changed", { clientId }); };
  const save = useMutation({
    mutationFn: () => {
      const p = Number(price), n = Number(size);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Enter the package price");
      if (!Number.isFinite(n) || n < 1) throw new Error("Enter the package size");
      return prep({ data: { clientId, startYmd: start, price: p, totalVisits: n } });
    },
    onSuccess: () => done("Renewal updated"),
    onError: (e: Error) => toast.error(e.message),
  });
  const cx = useMutation({
    mutationFn: () => cancel({ data: { clientId } }),
    onSuccess: () => done("Renewal cancelled"),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm">{line}</div>
          <div className="text-xs text-muted-foreground">{status}</div>
        </div>
        {isAdmin && !editing && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
            <Button size="sm" variant="outline" disabled={cx.isPending} onClick={() => { if (confirm("Cancel this prepared renewal?")) cx.mutate(); }}>Cancel renewal</Button>
          </div>
        )}
      </div>
      {isAdmin && editing && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Price<Input aria-label="Prepared price" type="number" min={0} step="0.01" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="text-xs">Visits<Input aria-label="Prepared package size" type="number" min={1} className="h-9 w-20" value={size} onChange={(e) => setSize(e.target.value)} /></label>
          <label className="text-xs">Start<Input aria-label="Prepared start date" type="date" className="h-9 w-40" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Close</Button>
        </div>
      )}
    </div>
  );
}
