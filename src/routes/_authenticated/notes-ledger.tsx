import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, fullName } from "@/lib/clients";
import {
  previewNotesLedger,
  applyNotesLedger,
  resolveNotesLedgerRow,
  undoNotesLedgerApply,
  noteAlreadyExists,
  REVIEW_CATEGORY_LABELS,
  type PreviewResult,
  type AutoUpdateRow,
  type ApplyRowResult,
  type ReviewRow,
  type ReviewCategory,
  type MatchClient,
  type LedgerResolutionInput,
} from "@/lib/notesLedger.functions";

const RECENTLY_APPLIED_TTL_MS = 12000;

type RecentlyApplied = {
  id: string;
  line_number: number;
  row_fingerprint: string;
  client_id: string;
  client_name: string;
  applied_at: number;
  before: {
    package_price: number;
    package_total_visits: number;
    package_start_date: string | null;
    amount_paid: number;
    internal_notes: string | null;
  };
  after: {
    package_price: number;
    package_total_visits: number;
    package_start_date: string | null;
    amount_paid: number;
    internal_notes: string | null;
  };
  appended_note: string | null;
  note_status: "append" | "already_exists" | "no_note";
  undone: boolean;
};

function ledgerResolutionInput(row: ReviewRow | AutoUpdateRow["parsed"]): LedgerResolutionInput {
  return {
    row_fingerprint: row.row_fingerprint,
    line_number: row.line_number,
    raw: row.raw,
    name: row.name ?? null,
    phone: row.phone ?? null,
    leading_amount: row.leading_amount ?? null,
    package_price: row.package_price ?? null,
    package_total_visits: row.package_total_visits ?? null,
    package_start_date: row.package_start_date ?? null,
    internal_notes: row.internal_notes ?? null,
  };
}


export const Route = createFileRoute("/_authenticated/notes-ledger")({
  head: () => ({ meta: [{ title: "Notes Ledger Import · FBT Admin" }] }),
  component: NotesLedgerPage,
});

function NotesLedgerPage() {
  const previewFn = useServerFn(previewNotesLedger);
  const applyFn = useServerFn(applyNotesLedger);
  const resolveFn = useServerFn(resolveNotesLedgerRow);
  const undoFn = useServerFn(undoNotesLedgerApply);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [applied, setApplied] = useState<{ updated: number; errors: number } | null>(null);
  const [applyRows, setApplyRows] = useState<ApplyRowResult[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [reviewSelection, setReviewSelection] = useState<Map<number, string>>(new Map());
  const [resolvedReviews, setResolvedReviews] = useState<Set<string>>(new Set());
  const [skippedReviews, setSkippedReviews] = useState<Set<string>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<ReviewCategory>>(new Set());
  const [recentlyApplied, setRecentlyApplied] = useState<RecentlyApplied[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (recentlyApplied.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [recentlyApplied.length]);

  const visibleRecent = recentlyApplied.filter(
    (r) => now - r.applied_at < RECENTLY_APPLIED_TTL_MS,
  );


  const previewMut = useMutation({
    mutationFn: async () => previewFn({ data: { text } }),
    onSuccess: (r) => {
      setPreview(r);
      setApplied(null);
      setApplyRows([]);
      setExcluded(new Set());
      setReviewSelection(new Map());
      setResolvedReviews(new Set());
      setSkippedReviews(new Set());
      setActiveCategories(new Set());
      setRecentlyApplied([]);
      toast.success(`Parsed ${r.parsed_count} rows`);
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const applyMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Run preview first");
      const updates = preview.auto_updates
        .filter((r) => !excluded.has(r.client.id))
        .map((r) => ({
          client_id: r.client.id,
          client_name: fullName(r.client),
          parsed_name: r.parsed.name ?? null,
          line_number: r.parsed.line_number,
          resolution_row: ledgerResolutionInput(r.parsed),
          package_price: r.changes.package_price.after,
          package_total_visits: r.changes.package_total_visits.after,
          package_start_date: r.changes.package_start_date.after,
          amount_paid: r.changes.amount_paid.after,
          appended_note: r.changes.internal_notes.appended,
        }));
      return applyFn({ data: { updates } });
    },
    onSuccess: (r) => {
      setApplied({ updated: r.updated, errors: r.errors.length });
      setApplyRows(r.rows);
      // Auto-exclude successful rows so only failed rows remain checked for retry.
      setExcluded((prev) => {
        const next = new Set(prev);
        for (const row of r.rows) {
          if (row.status === "success") next.add(row.client_id);
        }
        return next;
      });
      if (r.errors.length) toast.error(`${r.errors.length} row(s) failed — see Apply Results below`);
      else toast.success(`Updated ${r.updated} clients`);
      console.log("Ledger apply results:", r);
      if (r.errors.length) console.error("Ledger apply errors:", r.rows.filter((x) => x.status === "error"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviewApplyMut = useMutation({
    mutationFn: async (args: { row: ReviewRow; client: MatchClient }) => {
      const { row, client } = args;
      const price = row.package_price ?? Number(client.package_price ?? 0);
      const visits = row.package_total_visits ?? Number(client.package_total_visits ?? 0);
      const startDate = row.package_start_date ?? client.package_start_date;
      const paid = row.amount_paid !== null ? row.amount_paid : Number(client.amount_paid ?? 0);
      const appended =
        row.internal_notes && !noteAlreadyExists(client.internal_notes, row.internal_notes)
          ? row.internal_notes
          : null;
      const res = await applyFn({
        data: {
          updates: [
            {
              client_id: client.id,
              client_name: fullName(client),
              parsed_name: row.name ?? null,
              line_number: row.line_number,
              resolution_row: ledgerResolutionInput(row),
              package_price: price,
              package_total_visits: visits,
              package_start_date: startDate,
              amount_paid: paid,
              appended_note: appended,
            },
          ],
        },
      });
      return { res, rowFingerprint: row.row_fingerprint };
    },
    onSuccess: ({ res, rowFingerprint }) => {
      const row = res.rows[0];
      if (!row || row.status === "error") {
        toast.error(`Apply failed: ${row?.error ?? "Unknown error"}`);
        return;
      }
      const before = row.before ?? {
        package_price: 0,
        package_total_visits: 0,
        package_start_date: null,
        amount_paid: 0,
        internal_notes: null,
      };
      const after = {
        package_price: row.fields.package_price,
        package_total_visits: row.fields.package_total_visits,
        package_start_date: row.fields.package_start_date,
        amount_paid: row.fields.amount_paid,
        internal_notes: row.fields.internal_notes_after,
      };
      const appended = row.fields.appended_note;
      const noteStatus: RecentlyApplied["note_status"] = appended
        ? "append"
        : before.internal_notes && before.internal_notes.length > 0
          ? "already_exists"
          : "no_note";
      setRecentlyApplied((prev) => [
        {
          id: `${rowFingerprint}-${Date.now()}`,
          line_number: row.line_number ?? 0,
          row_fingerprint: rowFingerprint,
          client_id: row.client_id,
          client_name: row.client_name,
          applied_at: Date.now(),
          before,
          after,
          appended_note: appended,
          note_status: noteStatus,
          undone: false,
        },
        ...prev,
      ]);
      setNow(Date.now());
      // Immediately remove from Needs Review and clear selection.
      setResolvedReviews((prev) => new Set(prev).add(rowFingerprint));
      setReviewSelection((prev) => {
        const next = new Map(prev);
        if (row.line_number !== null) next.delete(row.line_number);
        return next;
      });
      toast.success(`Applied to ${row.client_name}`);
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const resolveReviewMut = useMutation({
    mutationFn: async (args: { row: ReviewRow; status: "skipped" | "resolved" }) => {
      const reason = args.status === "skipped" ? "Skipped row" : "Marked resolved";
      const res = await resolveFn({
        data: {
          row: ledgerResolutionInput(args.row),
          status: args.status,
          reason,
        },
      });
      return { res, row: args.row, status: args.status };
    },
    onSuccess: ({ row, status }) => {
      if (status === "skipped") setSkippedReviews((prev) => new Set(prev).add(row.row_fingerprint));
      else setResolvedReviews((prev) => new Set(prev).add(row.row_fingerprint));
      setReviewSelection((prev) => {
        const next = new Map(prev);
        next.delete(row.line_number);
        return next;
      });
      toast.success(status === "skipped" ? "Row skipped and saved" : "Row marked resolved and saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undoMut = useMutation({
    mutationFn: async (entry: RecentlyApplied) => {
      await undoFn({
        data: {
          client_id: entry.client_id,
          before: entry.before,
          row_fingerprint: entry.row_fingerprint,
        },
      });
      return entry;
    },
    onSuccess: (entry) => {
      setRecentlyApplied((prev) =>
        prev.map((r) => (r.id === entry.id ? { ...r, undone: true } : r)),
      );
      // Restore into Needs Review so the row can be re-applied.
      setResolvedReviews((prev) => {
        const next = new Set(prev);
        next.delete(entry.row_fingerprint);
        return next;
      });
      toast.success(`Reverted changes to ${entry.client_name}`);
    },
    onError: (e: Error) => toast.error(`Undo failed: ${e.message}`),
  });


  const autoCount = preview ? preview.auto_updates.length - excluded.size : 0;

  const categoryCounts = new Map<ReviewCategory, number>();
  if (preview) {
    for (const r of preview.reviews) {
      for (const c of r.categories) {
        categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1);
      }
    }
  }
  const visibleReviews = preview
    ? preview.reviews.filter((r) => {
        if (resolvedReviews.has(r.row_fingerprint) || skippedReviews.has(r.row_fingerprint)) return false;
        if (activeCategories.size === 0) return true;
        return r.categories.some((c) => activeCategories.has(c));
      })
    : [];


  return (
    <AppShell>
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Notes Ledger Import</h1>
      <p className="mb-6 max-w-3xl text-sm text-slate-500">
        Paste the latest Apple Notes package ledger. This tool parses each line, matches to
        existing Admin clients (preferring Square-linked), and lets you review changes before
        applying. It never modifies Square, phones, emails, timelines, or Square IDs.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Paste Ledger or Upload .txt</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-3">
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = typeof reader.result === "string" ? reader.result : "";
                  setText(result);
                  setPreview(null);
                  setApplied(null);
                  toast.success(`Loaded ${file.name} (${result.length.toLocaleString()} chars)`);
                };
                reader.onerror = () => toast.error("Could not read file");
                reader.readAsText(file, "utf-8");
                e.target.value = "";
              }}
              className="text-sm"
            />
            <span className="text-xs text-slate-500">
              UTF-8 .txt recommended for Apple Notes exports. Pasting also works.
            </span>
          </div>
          <Textarea
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste Apple Notes content, or upload a .txt file above…"
            className="font-mono text-xs"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setText("");
                setPreview(null);
                setApplied(null);
              }}
            >
              Clear
            </Button>
            <Button onClick={() => previewMut.mutate()} disabled={previewMut.isPending || !text.trim()}>
              {previewMut.isPending ? "Parsing…" : "Preview"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <StatCard label="Parsed" value={preview.parsed_count} />
            <StatCard label="Auto-update" value={autoCount} tone="emerald" />
            <StatCard label="Needs review" value={preview.reviews.length} tone="amber" />
            <StatCard label="Skipped" value={preview.skipped.length} tone="slate" />
          </div>

          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Review the changes below. Uncheck any row to exclude it from the apply step.
            </p>
            <Button
              onClick={() => applyMut.mutate()}
              disabled={applyMut.isPending || autoCount === 0}
            >
              {applyMut.isPending ? "Applying…" : `Apply ${autoCount} updates`}
            </Button>
          </div>

          {applied && (
            <Card className={`mb-6 ${applied.errors ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <CardHeader>
                <CardTitle className="text-base">
                  Apply Results — {applied.updated} success · {applied.errors} error
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-slate-600">
                  Successful rows have been auto-unchecked above. Failed rows remain checked so you can retry only them by clicking Apply again.
                </p>
                <div className="max-h-[500px] overflow-auto rounded border bg-white">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-left">
                      <tr>
                        <th className="p-2">Line</th>
                        <th className="p-2">Parsed name</th>
                        <th className="p-2">Matched client</th>
                        <th className="p-2">Client ID</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Step</th>
                        <th className="p-2">Error / Fields written</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applyRows.map((r, i) => (
                        <tr
                          key={r.client_id + i}
                          className={`border-t align-top ${r.status === "error" ? "bg-rose-50" : ""}`}
                        >
                          <td className="p-2">{r.line_number ?? "—"}</td>
                          <td className="p-2">{r.parsed_name ?? "—"}</td>
                          <td className="p-2 font-medium">{r.client_name}</td>
                          <td className="p-2 font-mono text-[10px] text-slate-500">{r.client_id}</td>
                          <td className="p-2">
                            {r.status === "success" ? (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">success</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-rose-100 text-rose-800">error</Badge>
                            )}
                          </td>
                          <td className="p-2">{r.step}</td>
                          <td className="p-2">
                            {r.error ? (
                              <div className="text-rose-700">
                                <div className="font-semibold">Failed on: {r.step}</div>
                                <div className="whitespace-pre-wrap">{r.error}</div>
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-slate-600">Fields being written</summary>
                                  <pre className="mt-1 whitespace-pre-wrap text-[10px]">{JSON.stringify(r.fields, null, 2)}</pre>
                                </details>
                              </div>
                            ) : (
                              <details>
                                <summary className="cursor-pointer text-slate-600">Fields written</summary>
                                <pre className="mt-1 whitespace-pre-wrap text-[10px]">{JSON.stringify(r.fields, null, 2)}</pre>
                              </details>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(applyRows, null, 2));
                    toast.success("Apply results JSON copied");
                  }}
                >
                  Copy JSON
                </Button>
              </CardContent>
            </Card>
          )}

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Auto-Update Candidates ({preview.auto_updates.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {preview.auto_updates.length === 0 && (
                <p className="text-sm text-slate-500">None.</p>
              )}
              {preview.auto_updates.map((r) => {
                const result = applyRows.find((x) => x.client_id === r.client.id);
                return (
                  <AutoUpdateCard
                    key={r.client.id + r.parsed.line_number}
                    row={r}
                    excluded={excluded.has(r.client.id)}
                    result={result}
                    onToggle={() => {
                      const next = new Set(excluded);
                      if (next.has(r.client.id)) next.delete(r.client.id);
                      else next.add(r.client.id);
                      setExcluded(next);
                    }}
                  />
                );
              })}
            </CardContent>
          </Card>

          {visibleRecent.length > 0 && (
            <Card className="mb-6 border-emerald-200 bg-emerald-50/60">
              <CardHeader>
                <CardTitle className="text-base">
                  Recently Applied ({visibleRecent.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-slate-600">
                  Confirmation of the changes committed to the database. Undo is
                  available for a few seconds after each apply.
                </p>
                {visibleRecent.map((entry) => (
                  <RecentlyAppliedCard
                    key={entry.id}
                    entry={entry}
                    now={now}
                    ttlMs={RECENTLY_APPLIED_TTL_MS}
                    onUndo={() => undoMut.mutate(entry)}
                    undoing={undoMut.isPending}
                  />
                ))}
              </CardContent>
            </Card>
          )}


          <Card className="mb-6">
            <CardHeader>
              <CardTitle>
                Needs Review ({visibleReviews.length}
                {visibleReviews.length !== preview.reviews.length
                  ? ` of ${preview.reviews.length}`
                  : ""}
                )
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {preview.reviews.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Filter:</span>
                  {(Object.keys(REVIEW_CATEGORY_LABELS) as ReviewCategory[])
                    .filter((c) => (categoryCounts.get(c) ?? 0) > 0)
                    .map((c) => {
                      const active = activeCategories.has(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            const next = new Set(activeCategories);
                            if (next.has(c)) next.delete(c);
                            else next.add(c);
                            setActiveCategories(next);
                          }}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                            active
                              ? "border-amber-500 bg-amber-500 text-white"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {REVIEW_CATEGORY_LABELS[c]} ({categoryCounts.get(c) ?? 0})
                        </button>
                      );
                    })}
                  {activeCategories.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveCategories(new Set())}
                      className="text-xs text-slate-500 underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {visibleReviews.length === 0 && (
                <p className="text-sm text-slate-500">
                  {preview.reviews.length === 0 ? "None." : "No rows match the current filters."}
                </p>
              )}
              {visibleReviews.map((r) => (
                <ReviewCard
                  key={r.line_number}
                  row={r}
                  selectedClientId={reviewSelection.get(r.line_number) ?? null}
                  onSelect={(clientId) => {
                    const next = new Map(reviewSelection);
                    next.set(r.line_number, clientId);
                    setReviewSelection(next);
                  }}
                  onApply={(client) => reviewApplyMut.mutate({ row: r, client })}
                  onSkip={() => resolveReviewMut.mutate({ row: r, status: "skipped" })}
                  onMarkResolved={() => resolveReviewMut.mutate({ row: r, status: "resolved" })}
                  applying={reviewApplyMut.isPending || resolveReviewMut.isPending}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Skipped ({preview.skipped.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {preview.skipped.length === 0 && (
                <p className="text-slate-500">None.</p>
              )}
              {preview.skipped.map((s, idx) => (
                <div key={idx} className="flex justify-between border-b py-1">
                  <span className="font-mono text-xs text-slate-600">{s.parsed.raw}</span>
                  <span className="text-xs text-slate-500">{s.reason}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Diagnostic Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(preview.diagnostic_summary).map(([k, v]) => (
                  <div key={k} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <div className="text-xs text-slate-500">{k.replace(/_/g, " ")}</div>
                    <div className="text-lg font-semibold">{v as number}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const rows = preview.diagnostics;
                    const headers = [
                      "line","parsed_name","parsed_phone","parsed_price","parsed_date","parsed_visits","parsed_amount_paid",
                      "phone_match_count","name_match_count","combined_unique","square_linked","outcome","rule","reason",
                    ];
                    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                    const csv = [headers.join(",")].concat(
                      rows.map((r) => [
                        r.line_number, r.parsed_name, r.parsed_phone, r.parsed_package_price,
                        r.parsed_package_date, r.parsed_visits, r.parsed_amount_paid,
                        r.phone_match_count, r.name_match_count, r.combined_unique_count,
                        r.square_linked_count, r.outcome, r.rule, r.reason,
                      ].map(esc).join(","))
                    ).join("\n");
                    navigator.clipboard.writeText(csv);
                    toast.success("Diagnostic CSV copied to clipboard");
                  }}
                >
                  Copy CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(preview.diagnostics, null, 2));
                    toast.success("Diagnostic JSON copied to clipboard");
                  }}
                >
                  Copy JSON
                </Button>
              </div>
              <div className="max-h-[600px] overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left">
                    <tr>
                      <th className="p-1">#</th>
                      <th className="p-1">Name</th>
                      <th className="p-1">Phone</th>
                      <th className="p-1">Price</th>
                      <th className="p-1">Date</th>
                      <th className="p-1">Ph✓</th>
                      <th className="p-1">Nm✓</th>
                      <th className="p-1">Sq</th>
                      <th className="p-1">Outcome</th>
                      <th className="p-1">Rule</th>
                      <th className="p-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.diagnostics
                      .filter((d) => d.outcome !== "auto_update")
                      .map((d) => (
                        <tr key={d.line_number} className="border-t align-top">
                          <td className="p-1">{d.line_number}</td>
                          <td className="p-1">{d.parsed_name}</td>
                          <td className="p-1 font-mono">{d.parsed_phone ?? "—"}</td>
                          <td className="p-1">{d.parsed_package_price ?? "—"}</td>
                          <td className="p-1">{d.parsed_package_date ?? "—"}</td>
                          <td className="p-1 text-center">{d.phone_match_count}</td>
                          <td className="p-1 text-center">{d.name_match_count}</td>
                          <td className="p-1 text-center">{d.square_linked_count}</td>
                          <td className="p-1">{d.outcome}</td>
                          <td className="p-1">{d.rule}</td>
                          <td className="p-1">{d.reason}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "emerald" | "amber";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}

function AutoUpdateCard({
  row,
  excluded,
  onToggle,
  result,
}: {
  row: AutoUpdateRow;
  excluded: boolean;
  onToggle: () => void;
  result?: ApplyRowResult;
}) {
  const c = row.changes;
  const border = result?.status === "error"
    ? "border-rose-300 bg-rose-50"
    : result?.status === "success"
      ? "border-emerald-300 bg-emerald-50/60"
      : excluded
        ? "border-slate-200 bg-slate-50 opacity-60"
        : "border-emerald-200 bg-white";
  return (
    <div className={`rounded border p-3 text-sm ${border}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={!excluded} onChange={onToggle} />
        <span className="font-semibold">{fullName(row.client)}</span>
        {row.client.square_customer_id && (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">Square</Badge>
        )}
        {row.parsed.assessment && <Badge variant="secondary">Assessment</Badge>}
        <span className="text-xs text-slate-500">Line {row.parsed.line_number}</span>
        {result?.status === "success" && (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Applied</Badge>
        )}
        {result?.status === "error" && (
          <Badge variant="secondary" className="bg-rose-100 text-rose-800">Failed — {result.step}</Badge>
        )}
      </div>
      {result?.status === "error" && (
        <div className="mb-2 rounded border border-rose-200 bg-white p-2 text-xs text-rose-700">
          {result.error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <DiffRow label="Price" before={formatCurrency(c.package_price.before)} after={formatCurrency(c.package_price.after)} changed={c.package_price.changed} />
        <DiffRow label="Visits" before={String(c.package_total_visits.before)} after={String(c.package_total_visits.after)} changed={c.package_total_visits.changed} />
        <DiffRow label="Start" before={formatDate(c.package_start_date.before)} after={formatDate(c.package_start_date.after)} changed={c.package_start_date.changed} />
        <DiffRow label="Paid" before={formatCurrency(c.amount_paid.before)} after={formatCurrency(c.amount_paid.after)} changed={c.amount_paid.changed} />
        <DiffRow label="Owed" before={formatCurrency(c.amount_owed.before)} after={formatCurrency(c.amount_owed.after)} changed={c.amount_owed.changed} />
        <div className="col-span-full">
          <span className="font-medium">Notes:</span>{" "}
          {c.internal_notes.note_status === "append" && c.internal_notes.appended && (
            <span className="text-emerald-700">
              Append {c.internal_notes.appended_count} new note
              {c.internal_notes.appended_count === 1 ? "" : "s"} — {c.internal_notes.appended}
            </span>
          )}
          {c.internal_notes.note_status === "already_exists" && (
            <span className="text-slate-500">No new notes (already exists)</span>
          )}
          {c.internal_notes.note_status === "no_note" && (
            <span className="text-slate-500">No new notes</span>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-500 font-mono">{row.parsed.raw}</div>
    </div>
  );
}

function DiffRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <div>
      <span className="text-slate-500">{label}:</span>{" "}
      {changed ? (
        <>
          <span className="text-slate-500 line-through">{before}</span>{" "}
          <span className="font-semibold text-emerald-700">→ {after}</span>
        </>
      ) : (
        <span>{after}</span>
      )}
    </div>
  );
}

function ReviewCard({
  row,
  selectedClientId,
  onSelect,
  onApply,
  onSkip,
  onMarkResolved,
  applying,
}: {
  row: ReviewRow;
  selectedClientId: string | null;
  onSelect: (clientId: string) => void;
  onApply: (client: MatchClient) => void;
  onSkip: () => void;
  onMarkResolved: () => void;
  applying: boolean;
}) {
  const selectedClient = row.candidates.find((c) => c.id === selectedClientId) ?? null;
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-400 text-amber-800">
          Line {row.line_number}
        </Badge>
        {row.assessment && <Badge variant="secondary">Assessment</Badge>}
        <span className="font-semibold">{row.name ?? "(no name)"}</span>
        {row.categories.map((c) => (
          <Badge
            key={c}
            variant="secondary"
            className="bg-amber-100 text-amber-900"
          >
            {REVIEW_CATEGORY_LABELS[c]}
          </Badge>
        ))}
      </div>
      <div className="text-xs text-slate-600">{row.reason}</div>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-slate-700">
        {row.raw}
      </pre>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><span className="text-slate-500">Parsed price:</span> {row.package_price !== null ? formatCurrency(row.package_price) : "—"}</div>
        <div><span className="text-slate-500">Parsed visits:</span> {row.package_total_visits ?? "—"}</div>
        <div><span className="text-slate-500">Parsed start:</span> {row.package_start_date ? formatDate(row.package_start_date) : "—"}</div>
        <div><span className="text-slate-500">Parsed paid:</span> {row.amount_paid !== null ? formatCurrency(row.amount_paid) : "—"}</div>
      </div>

      <div className="mt-2 text-xs">
        <span className="text-slate-500">Notes:</span>{" "}
        {row.note_status === "append" && row.internal_notes && (
          <span className="text-emerald-700">Would append — {row.internal_notes}</span>
        )}
        {row.note_status === "already_exists" && (
          <span className="text-slate-500">Note already exists — no append needed.</span>
        )}
        {row.note_status === "no_note" && (
          <span className="text-slate-500">No new notes</span>
        )}
      </div>

      {row.candidates.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-slate-600">
            Possible matches ({row.candidates.length}) — select one to apply:
          </div>
          {row.candidates.map((c) => {
            const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
            const active = c.id === selectedClientId;
            return (
              <label
                key={c.id}
                className={`flex cursor-pointer flex-col gap-1 rounded border p-2 ${
                  active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="radio"
                    name={`review-${row.line_number}`}
                    checked={active}
                    onChange={() => onSelect(c.id)}
                  />
                  <span className="font-semibold">{fullName(c)}</span>
                  {c.square_customer_id && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">Square</Badge>
                  )}
                  <span className="font-mono text-xs text-slate-600">{c.phone ?? "no phone"}</span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-700 sm:grid-cols-4">
                  <div><span className="text-slate-500">Price:</span> {formatCurrency(Number(c.package_price ?? 0))}</div>
                  <div><span className="text-slate-500">Start:</span> {c.package_start_date ? formatDate(c.package_start_date) : "—"}</div>
                  <div><span className="text-slate-500">Owed:</span> {formatCurrency(owed)}</div>
                  <div><span className="text-slate-500">Status:</span> {c.status}</div>
                </div>
                {c.internal_notes && (
                  <div className="whitespace-pre-wrap text-xs text-slate-600">
                    <span className="text-slate-500">Notes:</span> {c.internal_notes}
                  </div>
                )}
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 text-xs text-slate-500">No active candidate clients found for this row.</div>
      )}

      {row.archived_candidates.length > 0 && (
        <details className="mt-3 rounded border border-slate-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer text-slate-600">
            Archived matches ({row.archived_candidates.length}) — not counted as active candidates
          </summary>
          <div className="mt-2 space-y-1">
            {row.archived_candidates.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 border-t pt-1 text-slate-600">
                <span className="font-medium">{fullName(c)}</span>
                <Badge variant="secondary" className="bg-slate-200 text-slate-700">archived</Badge>
                <span className="font-mono">{c.phone ?? "no phone"}</span>
                {c.square_customer_id && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800">Square</Badge>
                )}
              </div>
            ))}
          </div>
        </details>
      )}


      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => selectedClient && onApply(selectedClient)}
          disabled={!selectedClient || applying}
        >
          {applying ? "Applying…" : "Apply to selected client"}
        </Button>
        <Button size="sm" variant="outline" onClick={onSkip}>
          Skip row
        </Button>
        <Button size="sm" variant="outline" onClick={onMarkResolved}>
          Mark resolved
        </Button>
      </div>
    </div>
  );
}

function RecentlyAppliedCard({
  entry,
  now,
  ttlMs,
  onUndo,
  undoing,
}: {
  entry: RecentlyApplied;
  now: number;
  ttlMs: number;
  onUndo: () => void;
  undoing: boolean;
}) {
  const secondsLeft = Math.max(0, Math.ceil((ttlMs - (now - entry.applied_at)) / 1000));
  const { before, after } = entry;
  const changes: { label: string; before: string; after: string; changed: boolean }[] = [
    {
      label: "Package price",
      before: formatCurrency(before.package_price),
      after: formatCurrency(after.package_price),
      changed: before.package_price !== after.package_price,
    },
    {
      label: "Visits",
      before: String(before.package_total_visits),
      after: String(after.package_total_visits),
      changed: before.package_total_visits !== after.package_total_visits,
    },
    {
      label: "Start date",
      before: formatDate(before.package_start_date),
      after: formatDate(after.package_start_date),
      changed: (before.package_start_date ?? null) !== (after.package_start_date ?? null),
    },
    {
      label: "Amount paid",
      before: formatCurrency(before.amount_paid),
      after: formatCurrency(after.amount_paid),
      changed: before.amount_paid !== after.amount_paid,
    },
  ];
  const appendedLines = entry.appended_note
    ? entry.appended_note.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    : [];
  const appendedCount = appendedLines.length;
  const noteLine =
    entry.note_status === "append" && appendedCount > 0
      ? `Appended ${appendedCount} new note${appendedCount === 1 ? "" : "s"}`
      : "No new notes";
  return (
    <div
      className={`rounded border p-3 text-sm ${
        entry.undone ? "border-slate-200 bg-slate-50 opacity-70" : "border-emerald-300 bg-white"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-emerald-700">✓</span>
          <span className="font-semibold">
            {entry.undone ? "Reverted — " : "Applied to "}
            {entry.client_name}
          </span>
          <Badge variant="outline" className="text-xs">
            Line {entry.line_number}
          </Badge>
        </div>
        {!entry.undone && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Undo in {secondsLeft}s</span>
            <Button size="sm" variant="outline" onClick={onUndo} disabled={undoing}>
              {undoing ? "Undoing…" : "Undo"}
            </Button>
          </div>
        )}
      </div>
      <div className="text-xs text-slate-600">Changes made:</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {changes.map((c) => (
          <li key={c.label}>
            •{" "}
            {c.changed ? (
              <>
                <span className="font-medium">{c.label}:</span>{" "}
                <span className="text-slate-500 line-through">{c.before}</span>{" "}
                <span className="font-semibold text-emerald-700">→ {c.after}</span>
              </>
            ) : (
              <>
                <span className="font-medium">{c.label}:</span>{" "}
                <span className="text-slate-500">No change</span>
              </>
            )}
          </li>
        ))}
        <li>
          • <span className="font-medium">Notes:</span>{" "}
          <span
            className={
              entry.note_status === "append" ? "text-emerald-700" : "text-slate-500"
            }
          >
            {noteLine}
          </span>
        </li>
        {appendedCount > 0 && (
          <li className="pl-4">
            <ul className="space-y-0.5">
              {appendedLines.map((l, i) => (
                <li key={i} className="text-emerald-700">— {l}</li>
              ))}
            </ul>
          </li>
        )}
        <li>
          • <span className="text-slate-500">Ledger row marked as imported/resolved</span>
        </li>
      </ul>
    </div>
  );
}

