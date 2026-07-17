import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/require-admin";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/clients";
import {
  getPaymentHistoryWeek,
  type PaymentHistoryEntry,
  type PaymentHistoryWeek,
} from "@/lib/payment-history.functions";

const MAX_WEEKS = 12;

export const Route = createFileRoute("/_authenticated/payment-history")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [{ title: "Payment History — FIT Beyond Therapy" }],
  }),
  component: PaymentHistoryPage,
});

function formatWeekLabel(week: PaymentHistoryWeek): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });
  };
  const suffix =
    week.weeks_ago === 0 ? " (this week)" : week.weeks_ago === 1 ? " (last week)" : "";
  return `${fmt(week.week_start)} – ${fmt(week.week_end)}${suffix}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
}

type DayGroup = {
  date: string;
  label: string;
  entries: PaymentHistoryEntry[];
  total: number;
};

function groupEntriesByDay(entries: PaymentHistoryEntry[]): DayGroup[] {
  const map = new Map<string, PaymentHistoryEntry[]>();
  for (const e of entries) {
    const date = e.created_at.slice(0, 10);
    const list = map.get(date) ?? [];
    list.push(e);
    map.set(date, list);
  }
  const groups = Array.from(map.entries()).map(([date, items]) => {
    const total = items.reduce((sum, e) => sum + (e.applied_amount ?? e.amount ?? 0), 0);
    return {
      date,
      label: formatDayLabel(date),
      entries: items.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
      total,
    };
  });
  return groups.sort((a, b) => b.date.localeCompare(a.date));
}

function PaymentHistoryPage() {
  const fetchWeek = useServerFn(getPaymentHistoryWeek);
  const [weeksLoaded, setWeeksLoaded] = useState(1);

  const queries = useQueries({
    queries: Array.from({ length: weeksLoaded }, (_, i) => ({
      queryKey: ["payment-history-week", i],
      queryFn: () => fetchWeek({ data: { weeks_ago: i } }),
      staleTime: 60_000,
    })),
  });

  const canLoadMore = weeksLoaded < MAX_WEEKS;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Payment History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Square payments recorded to client accounts, grouped by week.
            Read-only.
          </p>
        </div>
        <Link to="/">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>

      <div className="space-y-6">
        {queries.map((q, i) => {
          const w = q.data;
          return (
            <Card key={i}>
              <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle className="text-lg">
                    {q.isLoading
                      ? `Week ${i === 0 ? "(this week)" : `${i} back`}`
                      : w
                        ? formatWeekLabel(w)
                        : `Week ${i}`}
                  </CardTitle>
                  {w && (
                    <div className="text-sm text-slate-600">
                      <span className="font-medium text-slate-900">
                        {formatCurrency(w.total)}
                      </span>{" "}
                      · {w.entries.length}{" "}
                      {w.entries.length === 1 ? "payment" : "payments"}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {q.isLoading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : q.isError ? (
                  <p className="text-sm text-red-600">
                    Failed to load: {(q.error as Error).message}
                  </p>
                ) : w?.error ? (
                  <p className="text-sm text-red-600">{w.error}</p>
                ) : !w || w.entries.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No Square payments recorded in this week.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="py-2 pr-3 font-medium">When</th>
                          <th className="py-2 pr-3 font-medium">Client</th>
                          <th className="py-2 pr-3 font-medium">Amount</th>
                          <th className="py-2 pr-3 font-medium">Applied</th>
                          <th className="py-2 pr-3 font-medium">Match</th>
                        </tr>
                      </thead>
                      {groupEntriesByDay(w.entries).map((day) => (
                        <tbody key={day.date}>
                          <tr className="border-b bg-slate-50">
                            <td
                              colSpan={5}
                              className="py-2 pl-3 pr-3 text-sm font-medium text-slate-900"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span>{day.label}</span>
                                <span className="text-xs font-normal text-slate-600">
                                  <span className="font-medium text-slate-900">
                                    {formatCurrency(day.total)}
                                  </span>{" "}
                                  · {day.entries.length}{" "}
                                  {day.entries.length === 1 ? "payment" : "payments"}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {day.entries.map((e) => (
                            <tr key={e.id} className="border-b last:border-0">
                              <td className="py-2 pr-3 pl-3 text-slate-600">
                                {formatTime(e.created_at)}
                              </td>
                              <td className="py-2 pr-3">
                                <Link
                                  to="/clients/$id"
                                  params={{ id: e.client_id }}
                                  className="text-slate-900 hover:underline"
                                >
                                  {e.client_name}
                                </Link>
                              </td>
                              <td className="py-2 pr-3 font-medium text-slate-900">
                                {e.amount != null ? formatCurrency(e.amount) : "—"}
                              </td>
                              <td className="py-2 pr-3 text-slate-700">
                                {e.applied_amount != null
                                  ? formatCurrency(e.applied_amount)
                                  : "—"}
                              </td>
                              <td className="py-2 pr-3 text-xs text-slate-500">
                                {e.match_method ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      ))}
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center">
        {canLoadMore ? (
          <Button
            variant="outline"
            onClick={() => setWeeksLoaded((n) => Math.min(MAX_WEEKS, n + 1))}
          >
            Load prior week
          </Button>
        ) : (
          <p className="text-sm text-slate-500">
            Showing the maximum of {MAX_WEEKS} weeks.
          </p>
        )}
      </div>
    </AppShell>
  );
}
