import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPackageSetupList } from "@/lib/package-setup.functions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/clients";

export function AssessmentPackageReview({ enabled }: { enabled: boolean }) {
  const fn = useServerFn(getPackageSetupList);
  const q = useQuery({ queryKey: ["renewal-forecast", "package-setup"], queryFn: () => fn(), enabled, staleTime: 60_000, retry: 1 });
  if (!enabled) return null;
  return <section className="mb-6 border-y py-4" aria-label="Assessment to training review">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Assessment → Training: Package Review {q.data && !q.data.error ? `(${q.data.review.length})` : ""}</h2>
      <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Checking…" : "Refresh review"}</Button>
    </div>
    <p className="mt-1 text-sm text-muted-foreground">Package or price missing. Payment status unconfirmed; not added to dues totals.</p>
    {q.isPending ? <p className="mt-3 text-sm text-muted-foreground">Reading Square assessments and training visits…</p>
      : q.isError || q.data?.error ? <p role="alert" className="mt-3 text-sm text-destructive">Review unavailable. Saved corrections and Square services must be readable.</p>
      : <>
        <ul className="mt-3 divide-y">
          {(q.data?.review ?? []).map((r) => <li key={r.client_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <Link className="font-semibold hover:underline" to="/clients/$id" params={{ id: r.client_id }}>{r.name}</Link>
              <p className="text-sm text-muted-foreground">Assessment {formatDate(r.assessment_ymd)} · {r.upcoming ? "Booked" : "Past visit"} {formatDate(r.visit_ymd)} · {r.service_name}</p>
              <p className="text-sm">{r.reason}</p>
            </div>
            <Button asChild size="sm" variant="outline"><Link to="/clients/$id" params={{ id: r.client_id }}>Review package</Link></Button>
          </li>)}
        </ul>
        {q.data?.review.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No assessment-to-training setup gaps found.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Square window: past 180 days / next 90 days. Last read {q.data ? new Date(q.data.checked_at).toLocaleString() : "—"}.</p>
      </>}
  </section>;
}