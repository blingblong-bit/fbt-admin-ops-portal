import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import {
  findDuplicatePairs,
  mergeDuplicatePair,
  ignoreDuplicatePair,
  resetDuplicateReview,
  type MergePair,
  type MergePairClient,
  type MergePairConfidence,
} from "@/lib/merges.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency, formatDate, fullName, amountOwed, visitsRemaining } from "@/lib/clients";

export const Route = createFileRoute("/_authenticated/merge-center")({
  component: MergeCenterPage,
});

type FilterKey =
  | "pending_high"
  | "pending_name"
  | "pending_phone"
  | "balance_conflict"
  | "blocked"
  | "resolved"
  | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pending_high", label: "High confidence (name + phone)" },
  { key: "pending_name", label: "Name only" },
  { key: "pending_phone", label: "Phone only" },
  { key: "balance_conflict", label: "Balance conflict" },
  { key: "blocked", label: "Blocked (different Square IDs)" },
  { key: "resolved", label: "Merged / Ignored" },
  { key: "all", label: "All pairs" },
];

function confLabel(c: MergePairConfidence): string {
  switch (c) {
    case "high_name_phone":
      return "Name + Phone";
    case "name_only":
      return "Name only";
    case "phone_only":
      return "Phone only";
  }
}

function MergeCenterPage() {
  const qc = useQueryClient();
  const fetchPairs = useServerFn(findDuplicatePairs);
  const doMerge = useServerFn(mergeDuplicatePair);
  const doIgnore = useServerFn(ignoreDuplicatePair);
  const doReset = useServerFn(resetDuplicateReview);

  const { data, isLoading, error } = useQuery({
    queryKey: ["merge-center-pairs"],
    queryFn: () => fetchPairs(),
  });

  const [filter, setFilter] = useState<FilterKey>("pending_high");

  const pairs = data?.pairs ?? [];

  const counts = useMemo(() => {
    const c = {
      pending_high: 0,
      pending_name: 0,
      pending_phone: 0,
      balance_conflict: 0,
      blocked: 0,
      resolved: 0,
      all: pairs.length,
    };
    for (const p of pairs) {
      if (p.balance_conflict && p.status === "pending") c.balance_conflict++;
      if (p.status === "blocked") c.blocked++;
      if (p.status === "merged" || p.status === "ignored") c.resolved++;
      if (p.status === "pending") {
        if (p.confidence === "high_name_phone") c.pending_high++;
        else if (p.confidence === "name_only") c.pending_name++;
        else c.pending_phone++;
      }
    }
    return c;
  }, [pairs]);

  const filtered = useMemo(() => {
    return pairs.filter((p) => {
      switch (filter) {
        case "pending_high":
          return p.status === "pending" && p.confidence === "high_name_phone";
        case "pending_name":
          return p.status === "pending" && p.confidence === "name_only";
        case "pending_phone":
          return p.status === "pending" && p.confidence === "phone_only";
        case "balance_conflict":
          return p.status === "pending" && p.balance_conflict;
        case "blocked":
          return p.status === "blocked";
        case "resolved":
          return p.status === "merged" || p.status === "ignored";
        case "all":
          return true;
      }
    });
  }, [pairs, filter]);

  const mergeMut = useMutation({
    mutationFn: (v: { kept_id: string; archive_id: string; force?: boolean }) =>
      doMerge({ data: v }),
    onSuccess: (res) => {
      toast.success(
        res.fields_copied.length
          ? `Merged. Copied: ${res.fields_copied.join(", ")}`
          : "Merged. No new fields copied.",
      );
      qc.invalidateQueries({ queryKey: ["merge-center-pairs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ignoreMut = useMutation({
    mutationFn: (v: { a_id: string; b_id: string }) => doIgnore({ data: v }),
    onSuccess: () => {
      toast.success("Marked as ignored");
      qc.invalidateQueries({ queryKey: ["merge-center-pairs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (v: { a_id: string; b_id: string }) => doReset({ data: v }),
    onSuccess: () => {
      toast.success("Review reset to pending");
      qc.invalidateQueries({ queryKey: ["merge-center-pairs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Merge Center</h1>
          <p className="text-sm text-slate-600">
            Review and merge duplicate client records created between the legacy Notes import and
            the Square Production import. Nothing is auto-merged — every action requires
            confirmation.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["merge-center-pairs"] })}
        >
          Refresh
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = counts[f.key];
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md border px-3 py-1.5 text-sm ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {f.label}
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-xs ${active ? "bg-white/20" : "bg-slate-100 text-slate-700"}`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading && <div className="text-sm text-slate-500">Scanning for duplicates…</div>}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(error as Error).message}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-slate-600">
            No pairs in this view.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {filtered.map((p) => (
          <PairCard
            key={`${p.left.id}-${p.right.id}`}
            pair={p}
            onMerge={(force) =>
              mergeMut.mutate({
                kept_id: p.recommended_keep_id ?? p.right.id,
                archive_id:
                  (p.recommended_keep_id ?? p.right.id) === p.right.id ? p.left.id : p.right.id,
                force,
              })
            }
            onMergeInto={(keptId, force) =>
              mergeMut.mutate({
                kept_id: keptId,
                archive_id: keptId === p.right.id ? p.left.id : p.right.id,
                force,
              })
            }
            onIgnore={() => ignoreMut.mutate({ a_id: p.left.id, b_id: p.right.id })}
            onReset={() => resetMut.mutate({ a_id: p.left.id, b_id: p.right.id })}
            busy={mergeMut.isPending || ignoreMut.isPending || resetMut.isPending}
          />
        ))}
      </div>
    </AppShell>
  );
}

function ClientCol({
  c,
  side,
  isKept,
}: {
  c: MergePairClient;
  side: "left" | "right";
  isKept: boolean;
}) {
  const owed = amountOwed(c);
  const remaining = visitsRemaining(c);
  return (
    <div
      className={`rounded-lg border p-4 ${isKept ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {side === "left" ? "Legacy Notes candidate" : "Square-linked candidate"}
          </div>
          <Link
            to="/clients/$id"
            params={{ id: c.id }}
            className="text-base font-semibold text-slate-900 hover:underline"
          >
            {fullName(c)}
          </Link>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isKept && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Keep</Badge>
          )}
          {c.is_square_linked ? (
            <Badge variant="outline" className="border-blue-300 text-blue-700">
              Square linked
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              No Square ID
            </Badge>
          )}
          {c.has_square_import_marker && (
            <Badge variant="outline" className="border-slate-300 text-slate-600">
              Square import
            </Badge>
          )}
          <Badge variant="outline" className="border-slate-300 text-slate-600">
            {c.status}
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Phone</dt>
        <dd>{c.phone ?? "—"}</dd>
        <dt className="text-slate-500">Email</dt>
        <dd className="truncate">{c.email ?? "—"}</dd>
        <dt className="text-slate-500">Package</dt>
        <dd>{c.package_name ?? "—"}</dd>
        <dt className="text-slate-500">Price</dt>
        <dd>{formatCurrency(c.package_price)}</dd>
        <dt className="text-slate-500">Paid</dt>
        <dd>{formatCurrency(c.amount_paid)}</dd>
        <dt className="text-slate-500">Owed</dt>
        <dd className={owed > 0 ? "font-medium text-red-700" : ""}>{formatCurrency(owed)}</dd>
        <dt className="text-slate-500">Visits</dt>
        <dd>
          {c.visits_used ?? "—"} / {c.package_total_visits} ·{" "}
          {remaining === null ? "—" : `${remaining} left`}
        </dd>
        <dt className="text-slate-500">Start date</dt>
        <dd>{formatDate(c.package_start_date)}</dd>
        <dt className="text-slate-500">Square ID</dt>
        <dd className="truncate font-mono text-xs">{c.square_customer_id ?? "—"}</dd>
        <dt className="text-slate-500">Created</dt>
        <dd>{formatDate(c.created_at)}</dd>
      </dl>

      {c.internal_notes && (
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-500">Internal notes</div>
          <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
            {c.internal_notes}
          </div>
        </div>
      )}

      {c.activities && c.activities.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-500">Timeline (latest)</div>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {c.activities.slice(0, 5).map((a) => (
              <li key={a.id}>
                <span className="text-slate-400">{formatDate(a.created_at)} · </span>
                {a.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PairCard({
  pair,
  onMerge,
  onMergeInto,
  onIgnore,
  onReset,
  busy,
}: {
  pair: MergePair;
  onMerge: (force?: boolean) => void;
  onMergeInto: (keptId: string, force?: boolean) => void;
  onIgnore: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const keptId = pair.recommended_keep_id ?? pair.right.id;
  const canOneClick = pair.status === "pending" && !pair.balance_conflict && !pair.square_conflict;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">
            {fullName(pair.left)} ↔ {fullName(pair.right)}
          </CardTitle>
          <Badge variant="outline">{confLabel(pair.confidence)}</Badge>
          <span className="text-xs text-slate-500">{pair.reason}</span>
        </div>
        <div className="flex items-center gap-2">
          {pair.status === "merged" && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Merged</Badge>
          )}
          {pair.status === "ignored" && <Badge variant="secondary">Ignored</Badge>}
          {pair.status === "blocked" && (
            <Badge className="bg-red-600 text-white hover:bg-red-600">Blocked</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pair.square_conflict && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Both clients have different <code>square_customer_id</code> values. Merge blocked —
            manual review required.
          </div>
        )}
        {pair.balance_conflict && !pair.square_conflict && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Both records have package/payment data that doesn't match. One-click merge is disabled.
            Verify balances first, then use "Force merge into…" to override.
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <ClientCol c={pair.left} side="left" isKept={keptId === pair.left.id} />
          <ClientCol c={pair.right} side="right" isKept={keptId === pair.right.id} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {pair.status === "pending" && (
            <>
              {canOneClick && pair.recommended_keep_id && (
                <MergePreviewButton
                  pair={pair}
                  keptId={pair.recommended_keep_id}
                  force={false}
                  onConfirm={() => onMerge(false)}
                  disabled={busy}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  label="Merge into Square-linked client"
                />
              )}
              {!pair.square_conflict && (
                <>
                  <MergePreviewButton
                    pair={pair}
                    keptId={pair.right.id}
                    force={pair.balance_conflict}
                    onConfirm={() =>
                      onMergeInto(pair.right.id, pair.balance_conflict ? true : false)
                    }
                    disabled={busy}
                    variant="outline"
                    label={`${pair.balance_conflict ? "Force merge into " : "Merge into "}${fullName(pair.right)}`}
                  />
                  <MergePreviewButton
                    pair={pair}
                    keptId={pair.left.id}
                    force={pair.balance_conflict}
                    onConfirm={() =>
                      onMergeInto(pair.left.id, pair.balance_conflict ? true : false)
                    }
                    disabled={busy}
                    variant="outline"
                    label={`${pair.balance_conflict ? "Force merge into " : "Merge into "}${fullName(pair.left)}`}
                  />
                </>
              )}
              <Button variant="ghost" disabled={busy} onClick={onIgnore}>
                Ignore pair
              </Button>
            </>
          )}
          {(pair.status === "ignored" || pair.status === "merged" || pair.status === "blocked") && (
            <Button variant="outline" disabled={busy} onClick={onReset}>
              Reopen review
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MergePreviewButton({
  pair,
  keptId,
  force,
  onConfirm,
  disabled,
  variant,
  className,
  label,
}: {
  pair: MergePair;
  keptId: string;
  force: boolean;
  onConfirm: () => void;
  disabled: boolean;
  variant?: "outline";
  className?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const kept = keptId === pair.left.id ? pair.left : pair.right;
  const archive = keptId === pair.left.id ? pair.right : pair.left;

  const scalarChecks: { key: keyof MergePairClient; label: string }[] = [
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "package_name", label: "Package name" },
    { key: "package_start_date", label: "Start date" },
    { key: "square_visit_note", label: "Square visit note" },
    { key: "square_customer_id", label: "Square Customer ID" },
  ];
  const willCopyScalars = scalarChecks.filter(({ key }) => {
    const kv = kept[key];
    const av = archive[key];
    const keptEmpty = kv === null || kv === undefined || kv === "";
    const archHas = !(av === null || av === undefined || av === "");
    return keptEmpty && archHas;
  });
  const keptHasPkg =
    Number(kept.package_price ?? 0) > 0 || Number(kept.package_total_visits ?? 0) > 0;
  const archHasPkg =
    Number(archive.package_price ?? 0) > 0 || Number(archive.package_total_visits ?? 0) > 0;
  const willCopyPackage = !keptHasPkg && archHasPkg;
  const willAppendNotes = !!(archive.internal_notes ?? "").trim();
  const willReactivateKept = !!kept.square_customer_id && !archive.square_customer_id;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        disabled={disabled}
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Merge Preview</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  Keep
                </div>
                <div className="mt-1 font-medium text-slate-900">
                  ✔ {fullName(kept)}
                  {kept.square_customer_id ? " (Square-linked)" : ""}
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Archive
                </div>
                <div className="mt-1 font-medium text-slate-900">
                  ✔ {fullName(archive)}
                  {archive.square_customer_id ? " (Square-linked)" : " (Legacy Notes)"}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fields copied
                </div>
                <ul className="mt-1 space-y-0.5">
                  {willCopyPackage && (
                    <>
                      <li>✔ Package</li>
                      <li>✔ Visits</li>
                      <li>✔ Balance</li>
                      <li>✔ Payment history</li>
                    </>
                  )}
                  {willAppendNotes && <li>✔ Notes (appended)</li>}
                  {willCopyScalars.map((f) => (
                    <li key={f.key as string}>✔ {f.label}</li>
                  ))}
                  {!willCopyPackage && !willAppendNotes && willCopyScalars.length === 0 && (
                    <li className="text-slate-500">No new fields will be copied.</li>
                  )}
                </ul>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fields preserved on kept client
                </div>
                <ul className="mt-1 space-y-0.5">
                  <li>✔ Square Customer ID {kept.square_customer_id ? "" : "(none)"}</li>
                  <li>✔ Future bookings</li>
                  <li>✔ Webhook linkage</li>
                  {willReactivateKept && <li>✔ Reactivated (status → active)</li>}
                </ul>
              </div>

              {force && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  Force merge: balance/package conflict will be overridden.
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Confirm merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
