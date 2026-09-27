import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/require-admin";
import { formatDate } from "@/lib/clients";
import {
  confirmVisitNotes,
  getVisitNoteReview,
  unconfirmVisitNotes,
  type NoteChip,
  type VisitNoteReviewCard,
} from "@/lib/visit-note-review.functions";
import { ISSUE_LABELS, type NoteIssueKind } from "@/lib/square-visit-audit";

const TITLE = "Visit Note Review · FIT Beyond Therapy Admin";
const DESC = "Clients whose Square appointment visit-number notes look inconsistent and need a check in Square.";
const KEY = ["visit-note-review"];

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

function ReviewCard({ c, onChanged }: { c: VisitNoteReviewCard; onChanged: () => void }) {
  const confirm = useServerFn(confirmVisitNotes);
  const unconfirm = useServerFn(unconfirmVisitNotes);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
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

        {c.confirmed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 p-2 text-xs text-emerald-900">
            <span>
              Marked correct {new Date(c.confirmed.confirmed_at).toLocaleString()}
              {c.confirmed.reason ? ` — ${c.confirmed.reason}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => unconfirm({ data: { client_id: c.client_id } }), "Back on the review list")}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
            </Button>
          </div>
        ) : open ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why it's correct (optional), e.g. 9/11 was an assessment"
              maxLength={300}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => confirm({ data: { client_id: c.client_id, fingerprint: c.fingerprint, reason } }),
                    `${c.name} marked correct`,
                  )
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Hides this client from the list. If their Square appointments change, they come back if still flagged.
            </p>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> This is correct
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function VisitNoteReviewPage() {
  const fetchReview = useServerFn(getVisitNoteReview);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => fetchReview({ data: {} }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const d = q.data;

  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(KEY, await fetchReview({ data: { fresh: true } }));
      qc.invalidateQueries({ queryKey: ["visit-automation-review"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const busy = q.isFetching || refreshing;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visit Note Review</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Square notes decide visit position. This list only shows clients whose Square visit numbers don't
            follow on from each other. Fix the notes in Square, then refresh — or mark the client correct if the
            numbers are right as they are.
          </p>
        </div>
        <Button onClick={refresh} disabled={busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          Refresh Review
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-slate-500">Reading Square appointments…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {d?.error && <p className="text-sm text-red-600">Couldn't read Square: {d.error}</p>}

      {d && !d.error && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
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
              Square read at {new Date(d.generated_at).toLocaleTimeString()}
            </span>
            {d.confirmed.length > 0 && (
              <button
                className="rounded-full border border-emerald-300 px-3 py-1 text-emerald-800 hover:bg-emerald-50"
                onClick={() => setShowConfirmed((v) => !v)}
              >
                {showConfirmed ? "Hide" : "Show"} confirmed ({d.confirmed.length})
              </button>
            )}
          </div>

          {d.cards.length === 0 && (
            <p className="text-sm text-slate-600">All Square visit-note sequences look consistent.</p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {d.cards.map((c) => (
              <ReviewCard key={c.client_id} c={c} onChanged={() => q.refetch()} />
            ))}
          </div>

          {showConfirmed && d.confirmed.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-lg font-semibold">Marked correct</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {d.confirmed.map((c) => (
                  <ReviewCard key={c.client_id} c={c} onChanged={() => q.refetch()} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
