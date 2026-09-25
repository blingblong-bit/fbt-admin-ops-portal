import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/require-admin";
import { formatDate } from "@/lib/clients";
import { getVisitNoteReview, type NoteChip } from "@/lib/visit-note-review.functions";
import { ISSUE_LABELS, type NoteIssueKind } from "@/lib/square-visit-audit";

const TITLE = "Visit Note Review · FIT Beyond Therapy Admin";
const DESC = "Clients whose Square appointment visit-number notes look inconsistent and need a check in Square.";

export const Route = createFileRoute("/_authenticated/visit-note-review")({
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
  component: VisitNoteReviewPage,
});

function Chips({ items }: { items: NoteChip[] }) {
  if (items.length === 0) return <span className="text-slate-400">none</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((c, i) => (
        <span
          key={i}
          className={`rounded border px-2 py-0.5 text-xs ${c.status ? "border-dashed border-slate-300 bg-white text-slate-500" : "border-slate-200 bg-slate-50"}`}
        >
          <span className="font-semibold">{c.label ?? "no note"}</span>
          {c.status && <span className="italic"> · {c.status}</span>}{" "}
          <span className="text-slate-500">{formatDate(c.date.slice(0, 10))}</span>
        </span>
      ))}
    </div>
  );
}

function VisitNoteReviewPage() {
  const fetchReview = useServerFn(getVisitNoteReview);
  const q = useQuery({ queryKey: ["visit-note-review"], queryFn: () => fetchReview(), staleTime: 10 * 60_000 });
  const d = q.data;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visit Note Review</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Square notes decide visit position. This list only shows clients whose Square visit numbers don't
            follow on from each other. Fix the notes in Square, then refresh — the client drops off automatically.
          </p>
        </div>
        <Button onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh Review
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-slate-500">Reading Square appointments…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {d?.error && <p className="text-sm text-red-600">Couldn't read Square: {d.error}</p>}

      {d && !d.error && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-900 px-3 py-1 font-medium text-white">
              {d.cards.length} need review · {d.checked} checked
            </span>
            {(Object.keys(d.counts) as NoteIssueKind[])
              .filter((k) => d.counts[k] > 0)
              .map((k) => (
                <span key={k} className="rounded-full border border-slate-300 px-3 py-1 text-slate-700">
                  {ISSUE_LABELS[k]}: {d.counts[k]}
                </span>
              ))}
            <span className="px-1 py-1 text-slate-400">
              Checked {new Date(d.generated_at).toLocaleTimeString()}
            </span>
          </div>

          {d.cards.length === 0 && (
            <p className="text-sm text-slate-600">All Square visit-note sequences look consistent.</p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {d.cards.map((c) => (
              <Card key={c.client_id}>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        Hub: {c.hub} <span className="text-slate-400">(for context only)</span>
                      </div>
                    </div>
                    <Link
                      to="/clients/$id"
                      params={{ id: c.client_id }}
                      className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
                    >
                      Open client
                    </Link>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">Square past</div>
                    <Chips items={c.past} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">Square upcoming</div>
                    <Chips items={c.future} />
                  </div>
                  <ul className="space-y-1 rounded-md bg-amber-50 p-2 text-amber-900">
                    {c.issues.map((i, n) => (
                      <li key={n}>
                        <span className="font-medium">{i.reason}</span>
                        {i.expected && <span> — expected {i.expected}</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="text-xs text-slate-500">
                    Find in Square: search “{c.name}” · customer ID{" "}
                    <span className="select-all font-mono">{c.square_customer_id}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
