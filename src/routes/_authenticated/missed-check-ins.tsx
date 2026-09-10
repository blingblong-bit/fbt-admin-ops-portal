import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDayReview,
  getMissedCheckInSummary,
  getClinicToday,
  completeVisitForClient,
  type DayReviewRow,
} from "@/lib/schedule.functions";

export const Route = createFileRoute("/_authenticated/missed-check-ins")({
  head: () => ({
    meta: [
      { title: "Missed Check-Ins — FIT Beyond Therapy" },
      {
        name: "description",
        content: "Review scheduled appointments by day and record any check-ins that were missed.",
      },
      { property: "og:title", content: "Missed Check-Ins — FIT Beyond Therapy" },
      {
        property: "og:description",
        content: "Review scheduled appointments by day and record any check-ins that were missed.",
      },
    ],
  }),
  component: MissedCheckInsPage,
});

const CLINIC_TZ = "America/Chicago";

function clinicTodayYmd(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CLINIC_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATE_META: Record<
  DayReviewRow["check_state"],
  { label: string; className: string }
> = {
  checked_in: { label: "Checked In", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  missed: { label: "Missed Check-In", className: "bg-red-100 text-red-800 border-red-200" },
  dismissed: { label: "Dismissed", className: "bg-slate-100 text-slate-600 border-slate-200" },

  upcoming: { label: "Upcoming", className: "bg-slate-100 text-slate-700 border-slate-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-200 text-slate-600 border-slate-300" },
  no_show: { label: "No-Show", className: "bg-amber-100 text-amber-800 border-amber-200" },
  unmatched: { label: "No Client Match", className: "bg-amber-100 text-amber-800 border-amber-200" },
};

function MissedCheckInsPage() {
  const qc = useQueryClient();
  const fetchToday = useServerFn(getClinicToday);
  const fetchDay = useServerFn(getDayReview);
  const fetchSummary = useServerFn(getMissedCheckInSummary);
  const completeVisit = useServerFn(completeVisitForClient);

  const todayQ = useQuery({
    queryKey: ["clinic-today"],
    queryFn: () => fetchToday({}),
    staleTime: 5 * 60_000,
  });
  const today = todayQ.data?.today ?? clinicTodayYmd();

  const [date, setDate] = useState<string | null>(null);
  const selected = date ?? addDaysYmd(today, -1);

  const dayQ = useQuery({
    queryKey: ["day-review", selected],
    queryFn: () => fetchDay({ data: { date: selected } }),
  });

  const summaryQ = useQuery({
    queryKey: ["missed-check-ins"],
    queryFn: () => fetchSummary({}),
  });

  const checkIn = useMutation({
    mutationFn: (vars: { clientId: string; bookingId: string; startAt: string }) =>
      completeVisit({
        data: {
          clientId: vars.clientId,
          bookingId: vars.bookingId,
          appointmentStartAt: vars.startAt,
        },
      }),
    onSuccess: (res) => {
      const r = res as { visits_used?: number | null; activated_renewal?: boolean };
      toast.success(
        r?.activated_renewal
          ? `Checked in — new package activated (visit ${r.visits_used})`
          : r?.visits_used != null
            ? `Checked in — visit ${r.visits_used} recorded`
            : "Checked in",
      );
      qc.invalidateQueries({ queryKey: ["day-review"] });
      qc.invalidateQueries({ queryKey: ["missed-check-ins"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["completed-visit-bookings"] });
      qc.invalidateQueries({ queryKey: ["renewal-forecast"] });
    },
    onError: (e: Error) => toast.error(e.message || "Check in failed"),
  });

  const rows = dayQ.data?.rows ?? [];
  const missedCount = dayQ.data?.missed_count ?? 0;
  const summary = summaryQ.data;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">← Dashboard</Link>
          </Button>
        </div>

        <Card>
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{dayLabel(selected)}</div>
                <div className="text-xs text-muted-foreground">
                  {selected === today
                    ? "Today"
                    : selected === addDaysYmd(today, -1)
                      ? "Yesterday"
                      : selected}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  missedCount > 0
                    ? "bg-red-100 text-red-800 border-red-200"
                    : "bg-emerald-100 text-emerald-800 border-emerald-200"
                }`}
              >
                {missedCount} missed
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full"
                onClick={() => setDate(addDaysYmd(selected, -1))}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full"
                onClick={() => setDate(today)}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full"
                onClick={() => setDate(addDaysYmd(selected, 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="date"
                value={selected}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-2 text-sm"
              />
            </label>

            {summary && (summary.older_count > 0 || summary.yesterday_count > 0) ? (
              <div className="rounded-md border bg-amber-50 p-2 text-xs text-amber-900">
                <div className="font-semibold">
                  {summary.yesterday_count} missed yesterday
                  {summary.older_count > 0 ? ` · ${summary.older_count} older unresolved` : ""}
                </div>
                {summary.older_dates.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {summary.older_dates.map((d) => (
                      <button
                        key={d}
                        onClick={() => setDate(d)}
                        className="rounded border border-amber-300 bg-white px-2 py-1 font-medium"
                      >
                        {dayLabel(d)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {dayQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading appointments…</p>
        ) : dayQ.data?.error ? (
          <p className="text-sm text-red-600">{dayQ.data.error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments on this day.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const meta = STATE_META[r.check_state];
              const c = r.client;
              const noPackage = c ? (c.package_total_visits ?? 0) === 0 : false;
              const payPerVisit = c?.payment_model === "pay_per_visit";
              const progress =
                c && !noPackage && c.visits_used !== null
                  ? `${c.visits_used} / ${c.package_total_visits}`
                  : noPackage
                    ? payPerVisit
                      ? "Pay per visit"
                      : "No Package Info"
                    : "—";
              const busy =
                checkIn.isPending && checkIn.variables?.bookingId === r.booking_id;
              return (
                <Card key={r.booking_id}>
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {c ? (
                            <Link
                              to="/clients/$id"
                              params={{ id: c.id }}
                              className="hover:underline"
                            >
                              {c.first_name} {c.last_name}
                            </Link>
                          ) : (
                            "Unmatched Square customer"
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {timeLabel(r.start_at)}
                          {r.team_member_name ? ` · ${r.team_member_name}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {progress}
                          {c?.package_name ? ` · ${c.package_name}` : ""}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                    </div>

                    {r.check_state === "missed" && c ? (
                      <Button
                        className="min-h-11 w-full"
                        disabled={busy}
                        onClick={() =>
                          checkIn.mutate({
                            clientId: c.id,
                            bookingId: r.booking_id,
                            startAt: r.start_at,
                          })
                        }
                      >
                        {busy ? "Checking in…" : "Check In"}
                      </Button>
                    ) : null}

                    {r.check_state === "unmatched" ? (
                      <Button asChild variant="outline" className="min-h-11 w-full">
                        <Link to="/schedule-check">Link this customer</Link>
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
