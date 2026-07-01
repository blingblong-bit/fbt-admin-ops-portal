import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
  REVIEW_CATEGORY_LABELS,
  type PreviewResult,
  type AutoUpdateRow,
  type ApplyRowResult,
  type ReviewRow,
  type ReviewCategory,
  type MatchClient,
} from "@/lib/notesLedger.functions";

export const Route = createFileRoute("/_authenticated/notes-ledger")({
  head: () => ({ meta: [{ title: "Notes Ledger Import · FBT Admin" }] }),
  component: NotesLedgerPage,
});

function NotesLedgerPage() {
  const previewFn = useServerFn(previewNotesLedger);
  const applyFn = useServerFn(applyNotesLedger);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [applied, setApplied] = useState<{ updated: number; errors: number } | null>(null);
  const [applyRows, setApplyRows] = useState<ApplyRowResult[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const previewMut = useMutation({
    mutationFn: async () => previewFn({ data: { text } }),
    onSuccess: (r) => {
      setPreview(r);
      setApplied(null);
      setApplyRows([]);
      setExcluded(new Set());
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

  const autoCount = preview ? preview.auto_updates.length - excluded.size : 0;

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

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Needs Review ({preview.reviews.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.reviews.length === 0 && (
                <p className="text-sm text-slate-500">None.</p>
              )}
              {preview.reviews.map((r, idx) => (
                <div
                  key={idx}
                  className="rounded border border-amber-200 bg-amber-50 p-3 text-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-amber-400 text-amber-800">
                      Line {r.line_number}
                    </Badge>
                    {r.assessment && <Badge variant="secondary">Assessment</Badge>}
                    <span className="font-semibold">{r.name ?? "(no name)"}</span>
                    <span className="text-xs text-slate-500">{r.reason}</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">
                    {r.raw}
                  </pre>
                  {r.candidates.length > 0 && (
                    <div className="mt-2 text-xs">
                      Candidates:{" "}
                      {r.candidates.map((c) => (
                        <span key={c.id} className="mr-2 rounded bg-white px-2 py-0.5 shadow-sm">
                          {fullName(c)}
                          {c.square_customer_id ? " · Square" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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
        {c.internal_notes.appended && (
          <div className="col-span-full">
            <span className="font-medium">Append note:</span>{" "}
            <span className="text-emerald-700">{c.internal_notes.appended}</span>
          </div>
        )}
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
