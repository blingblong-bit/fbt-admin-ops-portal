import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/require-admin";
import { formatDate } from "@/lib/clients";
import { getVisitAutomationReview } from "@/lib/visit-automation-review.functions";
import { SOURCE_LABELS, type UpcomingVisit, type VisitSource } from "@/lib/effective-visit-state";
import { statusLabel } from "@/lib/square-visit-audit";

const TITLE = "Visit Automation Review · FIT Beyond Therapy Admin";
const DESC = "What the Hub worked out from Square visit notes and what renewal and dues actions follow.";

export const Route = createFileRoute("/_authenticated/visit-automation-review")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisitAutomationReviewPage,
});

const SOURCE_STYLE: Record<VisitSource, string> = {
  square: "bg-emerald-50 text-emerald-800 border-emerald-200",
  hub_fallback: "bg-slate-50 text-slate-700 border-slate-200",
  review_required: "bg-amber-50 text-amber-900 border-amber-200",
};

export function SourceLabel({ source }: { source: VisitSource }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SOURCE_STYLE[source]}`}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

function Chips({ items }: { items: UpcomingVisit[] }) {
  if (items.length === 0) return <span className="text-slate-400">none</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((c) => {
        const st = statusLabel(c.status);
        return (
          <span key={c.booking_id} className={`rounded border px-2 py-0.5 text-xs ${st ? "border-dashed border-slate-300 text-slate-500" : "border-slate-200 bg-slate-50"}`}>
            <span className="font-semibold">{c.note ?? "no note"}</span>
            {st && <span className="italic"> · {st}</span>}{" "}
            <span className="text-slate-500">{formatDate(c.date.slice(0, 10))}</span>
          </span>
        );
      })}
    </div>
  );
}

function VisitAutomationReviewPage() {
  const fetchReview = useServerFn(getVisitAutomationReview);
  const q = useQuery({ queryKey: ["visit-automation-review"], queryFn: () => fetchReview(), staleTime: 10 * 60_000 });
  const d = q.data;
  const i = d?.impact;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visit Automation Review</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            What the Hub worked out from Square visit notes and what it does because of it. Stored Hub visit counts are
            never changed here. Clients whose Square numbering needs review keep their current behaviour until Square is fixed.
          </p>
        </div>
        <Button onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-slate-500">Reading Square appointments…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {d?.error && <p className="text-sm text-red-600">Couldn't read Square: {d.error}</p>}

      {d && !d.error && i && (
        <>
          <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Square synced", i.square],
              ["Hub fallback", i.hub_fallback],
              ["Review required", i.review_required],
              ["Count differs from Hub", i.count_differs],
              ["Renewal date moves", i.renewal_date_moves],
              ["Payment Due week moves", i.payment_week_moves],
              ["Dues changes", i.dues_changes],
              ["· newly gain dues", i.dues_newly_gain],
              ["· dues removed/moved", i.dues_removed_or_moved],
              ["Held for review", i.held_for_review],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-md border border-slate-200 p-2">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-lg font-semibold">{n}</div>
              </div>
            ))}
          </div>
          <p className="mb-4 text-xs text-slate-400">
            {i.checked} package clients checked · {new Date(d.generated_at).toLocaleTimeString()}
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {d.cards.map((c) => (
              <Card key={c.client_id}>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 font-semibold">
                        {c.name} <SourceLabel source={c.source} />
                      </div>
                      <div className="text-xs text-slate-500">
                        Hub {c.hub} · Square {c.square ?? "—"} · Effective <span className="font-medium text-slate-700">{c.effective}</span>
                      </div>
                      <div className="text-xs text-slate-400">{c.reason}</div>
                    </div>
                    <Link to="/clients/$id" params={{ id: c.client_id }} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100">
                      Open client
                    </Link>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">Square recent</div>
                    <Chips items={c.recent} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">Square upcoming</div>
                    <Chips items={c.upcoming} />
                  </div>
                  <div className="text-xs text-slate-600">
                    {c.renewal_state}
                    {c.next_package_start && <> · next package {formatDate(c.next_package_start.slice(0, 10))}</>}
                    {c.amount_note && <> · {c.amount_note}</>}
                  </div>
                  <ul className="space-y-1 rounded-md bg-slate-50 p-2">
                    {c.actions.map((a, n) => <li key={n}>{a}</li>)}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
