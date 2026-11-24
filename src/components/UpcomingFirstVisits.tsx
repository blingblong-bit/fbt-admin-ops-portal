import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { preRenewNextPackage } from "@/lib/schedule.functions";
import { invalidateFor } from "@/lib/invalidation";
import { upcomingWeekSummary, type UpcomingFirstVisit } from "@/lib/upcoming-first-visit";

const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "Owes now" (unchanged total) plus the separate upcoming 1/x line for one Mon–Sun week. */
export function UpcomingWeekLine({ label, owesNow, items, weekStart }: { label: string; owesNow: number; items: UpcomingFirstVisit[]; weekStart: string }) {
  const s = upcomingWeekSummary(items, weekStart);
  return (
    <p className="text-sm">
      <span className="font-medium">{label}:</span> Owes now <b>{$(owesNow)}</b> · Upcoming 1/x {label === "Next week" ? "next week" : "this week"} <b>{$(s.dollars)}</b> ({s.needReview} need review)
    </p>
  );
}

export function UpcomingFirstVisitList({ items, isAdmin }: { items: UpcomingFirstVisit[]; isAdmin: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No booked 1/x visits this week.</p>;
  return <div className="space-y-2">{items.map((i) => <UpcomingRow key={i.booking_id} i={i} isAdmin={isAdmin} />)}</div>;
}

function UpcomingRow({ i, isAdmin }: { i: UpcomingFirstVisit; isAdmin: boolean }) {
  const qc = useQueryClient();
  const prep = useServerFn(preRenewNextPackage);
  const [price, setPrice] = useState(i.price != null ? String(i.price) : "");
  const ok = useMutation({
    mutationFn: () => {
      const p = Number(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error("Enter the package price first");
      return prep({ data: { clientId: i.client_id, startYmd: i.ymd, price: p, totalVisits: i.total_visits } });
    },
    onSuccess: () => { toast.success("Approved — owed once the 1/x visit starts"); invalidateFor(qc, "renewal-changed", { clientId: i.client_id }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const day = weekday(i.ymd);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <Link to="/clients/$id" params={{ id: i.client_id }} className="font-semibold hover:underline">{i.name}</Link>
          <div className="text-sm">1/{i.total_visits} on {day} · {i.remaining != null ? $(i.remaining) : "price needed"}{i.paid > 0 ? ` (paid ${$(i.paid)})` : ""}</div>
          <div className="text-xs text-muted-foreground">
            {i.status === "approved" ? `Approved · due ${day}, not owed yet` : "Needs review"}
            {i.status === "approved" && i.paid > 0 ? ` · Paid toward this renewal · ${$(i.paid)}` : ""}
          </div>
        </div>
        {isAdmin && i.status === "needs_review" && (
          <div className="flex items-center gap-2">
            <Input aria-label={`Price for ${i.name}`} type="number" min={0} step="0.01" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Button size="sm" disabled={ok.isPending} onClick={() => ok.mutate()}>OK</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
