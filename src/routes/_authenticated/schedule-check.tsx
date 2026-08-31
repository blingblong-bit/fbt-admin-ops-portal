import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { ChevronDown, MessageSquare, Phone } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, formatDateTimeLocal } from "@/lib/clients";
import { useRole } from "@/hooks/useRole";
import { RenewalFlagBadge, useRenewalFlaggedClientIds } from "@/components/RenewalFlagBadge";

import {
  completeVisitForClient,
  getCompletedVisitBookingIds,
  getContactedClientIds,
  getScheduleCheck,
  getUnavailableNextWeekClientIds,
  linkSquareCustomer,
  createClientFromSquareCustomer,
  listLinkableClients,
  markClientContacted,
  unmarkClientContacted,
  markClientUnavailableNextWeek,
  unmarkClientUnavailableNextWeek,
  type LinkableClient,
  type NeedsScheduleClient,
  type ScheduleAppointment,
} from "@/lib/schedule.functions";

import {
  backfillProductionCustomers,
  createClientFromSquareReview,
  ignoreSquareReview,
  linkSquareReview,
  listSquareCustomerReviews,
  type SquareCustomerReview,
} from "@/lib/backfill.functions";


export const Route = createFileRoute("/_authenticated/schedule-check")({
  head: () => ({ meta: [{ title: "Schedule Check — FIT Beyond Therapy" }] }),
  component: ScheduleCheckPage,
});

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function visitsRemaining(c: { package_total_visits: number; visits_used: number | null }) {
  if (c.visits_used === null || c.visits_used === undefined) return c.package_total_visits;
  return Math.max(0, c.package_total_visits - c.visits_used);
}

function ScheduleCheckPage() {
  const { isStaff } = useRole();
  const [date, setDate] = useState<string>(todayYmd());
  const [checkedIn, setCheckedIn] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>("");
  const fetchSchedule = useServerFn(getScheduleCheck);
  const completeVisit = useServerFn(completeVisitForClient);
  const fetchCompletedVisitBookingIds = useServerFn(getCompletedVisitBookingIds);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["schedule-check", date],
    queryFn: () => fetchSchedule({ data: { date } }),
    refetchInterval: (q) =>
      typeof document !== "undefined" && document.visibilityState === "visible" ? 60_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const completeMut = useMutation({
    mutationFn: (vars: { clientId: string; bookingId: string; startAt?: string }) =>
      completeVisit({
        data: {
          clientId: vars.clientId,
          bookingId: vars.bookingId,
          ...(vars.startAt ? { appointmentStartAt: vars.startAt } : {}),
        },
      }),

    onSuccess: (_r, vars) => {
      setCheckedIn((prev) => {
        const next = new Set(prev);
        next.add(vars.bookingId);
        return next;
      });
      toast.success("Visit recorded");
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["completed-visit-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runBackfill = useServerFn(backfillProductionCustomers);
  const backfillMut = useMutation({
    mutationFn: async () => {
      // Batched loop — server processes ~200 customers per call to stay
      // under Cloudflare Workers' 1000-subrequest / 30s limit. Keep looping
      // until the server reports done=true so a large customer set completes
      // across multiple safe requests instead of failing silently.
      let offset = 0;
      let total = 0;
      const agg = {
        auto_linked: 0,
        queued_for_review: 0,
        hidden_old: 0,
        updated_contact: 0,
        errors: [] as string[],
      };
      const progressToast = toast.loading("Backfill starting…");
      try {
        for (let i = 0; i < 50; i++) {
          const r = await runBackfill({ data: { offset } });
          agg.auto_linked += r.auto_linked;
          agg.queued_for_review += r.queued_for_review;
          agg.hidden_old += r.hidden_old;
          agg.updated_contact += r.updated_contact;
          agg.errors.push(...r.errors);
          total = r.total;
          offset = r.next_offset;
          toast.loading(
            `Backfill: ${Math.min(offset, total)} of ${total} processed…`,
            { id: progressToast },
          );
          if (r.done) break;
        }
        toast.dismiss(progressToast);
      } catch (e) {
        toast.dismiss(progressToast);
        throw e;
      }
      return { ...agg, processed: offset, total };
    },
    onSuccess: (r) => {
      toast.success(
        `Backfill complete — ${r.processed}/${r.total} processed · ${r.auto_linked} auto-linked · ${r.queued_for_review} need review · ${r.hidden_old} hidden (old) · ${r.updated_contact} contact updates · ${r.errors.length} errors`,
      );
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["square-reviews"] });
    },
    onError: (e: Error) => toast.error(`Backfill failed: ${e.message}`),
  });

  const listClientsFn = useServerFn(listLinkableClients);
  const linkableQuery = useQuery({
    queryKey: ["linkable-clients"],
    queryFn: () => listClientsFn(),
  });

  const rawData = query.data;
  const linkable = linkableQuery.data;

  const data = useMemo(() => {
    if (!rawData) return rawData;
    if (!linkable || linkable.length === 0) return rawData;

    const bySquare = new Map<string, LinkableClient>();
    for (const c of linkable) {
      if (c.square_customer_id) bySquare.set(c.square_customer_id, c);
    }

    const resolvedIds = new Set<string>();
    const promoted: ScheduleAppointment[] = [];
    for (const a of rawData.unmatched) {
      if (!a.square_customer_id) continue;
      const c = bySquare.get(a.square_customer_id);
      if (!c) continue;
      resolvedIds.add(a.booking_id);
      promoted.push({
        ...a,
        client: {
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone,
          package_total_visits: 0,
          visits_used: null,
          package_price: 0,
          amount_paid: 0,
          internal_notes: null,
          square_customer_id: c.square_customer_id,
          status: null,
          manual_active: null,
        },
      });
    }

    if (resolvedIds.size === 0) return rawData;

    const dayOf = (iso: string) => iso.slice(0, 10);
    const inRange = (iso: string, a: string, b: string) => {
      const d = dayOf(iso);
      return d >= a && d <= b;
    };
    const mergeInto = (list: ScheduleAppointment[], extras: ScheduleAppointment[]) =>
      [...list, ...extras].sort((x, y) => x.start_at.localeCompare(y.start_at));

    const forSelected = promoted.filter((a) => dayOf(a.start_at) === rawData.selected_date);
    const forThisWeek = promoted.filter((a) =>
      inRange(a.start_at, rawData.week_start, rawData.week_end),
    );
    const forNextWeek = promoted.filter((a) =>
      inRange(a.start_at, rawData.next_week_start, rawData.next_week_end),
    );

    return {
      ...rawData,
      selected_day: mergeInto(rawData.selected_day, forSelected),
      this_week: mergeInto(rawData.this_week, forThisWeek),
      next_week: mergeInto(rawData.next_week, forNextWeek),
      unmatched: rawData.unmatched.filter((a) => !resolvedIds.has(a.booking_id)),
    };
  }, [rawData, linkable]);

  // Every booking currently visible across all three views — used to ask the
  // server which ones already have a completed visit on record, so "Checked
  // In" reflects real, persisted state instead of resetting to blank every
  // time this page is left and re-opened.
  const visitProbes = useMemo(() => {
    const map = new Map<string, { booking_id: string; client_id: string | null; start_at: string | null }>();
    for (const a of [
      ...(data?.selected_day ?? []),
      ...(data?.this_week ?? []),
      ...(data?.next_week ?? []),
    ]) {
      map.set(a.booking_id, {
        booking_id: a.booking_id,
        client_id: a.client?.id ?? null,
        start_at: a.start_at ?? null,
      });
    }
    return Array.from(map.values()).sort((x, y) => x.booking_id.localeCompare(y.booking_id));
  }, [data]);
  const allBookingIds = useMemo(() => visitProbes.map((p) => p.booking_id), [visitProbes]);

  const completedVisitsQuery = useQuery({
    queryKey: ["completed-visit-bookings", allBookingIds],
    queryFn: () => fetchCompletedVisitBookingIds({ data: { appointments: visitProbes } }),
    enabled: allBookingIds.length > 0,
    staleTime: 30_000,
  });


  // Persisted truth (from the DB) unioned with anything just checked in this
  // session but not yet reflected in a refetch — avoids a flash back to
  // "not checked in" immediately after a successful click.
  const persistedCheckedIn = useMemo(
    () => new Set(completedVisitsQuery.data ?? []),
    [completedVisitsQuery.data],
  );
  const effectiveCheckedIn = useMemo(() => {
    const merged = new Set(persistedCheckedIn);
    for (const id of checkedIn) merged.add(id);
    return merged;
  }, [persistedCheckedIn, checkedIn]);

  useEffect(() => {
    if (!rawData || !linkable) return;
    const bySquare = new Set(
      linkable.filter((c) => c.square_customer_id).map((c) => c.square_customer_id as string),
    );
    const stale = rawData.unmatched.some(
      (a) => a.square_customer_id && bySquare.has(a.square_customer_id),
    );
    if (stale) {
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
    }
  }, [rawData, linkable, qc]);

  const remainingThisWeek = useMemo(
    () =>
      (data?.this_week ?? []).filter(
        (a) => a.start_at.slice(0, 10) > (data?.selected_date ?? ""),
      ),
    [data],
  );
  const nextWeekAppts = data?.next_week ?? [];
  const nextWeekClientIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of nextWeekAppts) if (a.client) s.add(a.client.id);
    return s;
  }, [nextWeekAppts]);
  const thisWeekNotNextWeek = useMemo(
    () =>
      (data?.this_week ?? []).filter((a) => {
        if (!a.client) return false;
        if (nextWeekClientIds.has(a.client.id)) return false;
        if (a.client.status === "archived") return false;
        const total = a.client.package_total_visits ?? 0;
        const used = a.client.visits_used;
        const left = used === null || used === undefined ? total : Math.max(0, total - used);
        if (left <= 0) return false;
        return true;
      }),
    [data, nextWeekClientIds],
  );

  const q = search.trim();
  const summary = useMemo(() => {
    if (!q) return null;
    const has = (arr: ScheduleAppointment[]) => arr.some((a) => matchesSearch(a, q));
    return {
      today: has(data?.selected_day ?? []),
      thisWeek: has(remainingThisWeek),
      nextWeek: has(nextWeekAppts),
      notNext: has(thisWeekNotNextWeek),
    };
  }, [q, data, remainingThisWeek, nextWeekAppts, thisWeekNotNextWeek]);
  const anyMatch =
    !!summary && (summary.today || summary.thisWeek || summary.nextWeek || summary.notNext);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Production Read-Only
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Schedule Check</h1>
          <p className="hidden text-slate-600 md:block">
            Read-only view of Square appointments from the <strong>Production</strong> Square
            account. Therapy Admin never writes back to Square. Bookings whose customer ID
            isn't linked to an Admin client appear under "Unmatched Appointments".
          </p>
          <div className="pt-2">
            <Button
              variant="outline"
              onClick={() => backfillMut.mutate()}
              disabled={backfillMut.isPending}
              className="h-11 md:h-9"
            >
              {backfillMut.isPending ? "Running backfill…" : "Backfill Square Customers"}
            </Button>
            <p className="mt-1 hidden text-xs text-slate-500 md:block">
              Pulls all Production Square customers. Auto-links to Admin clients only on a
              high-confidence email/phone match. Uncertain matches are sent to <em>Needs Review</em>{" "}
              below.
            </p>
          </div>
        </header>

        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Search a client to see where they're scheduled
          </label>
          <Input
            placeholder="Search client name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11"
          />
          {q && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {!anyMatch && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                  Not Scheduled — no scheduled appointments found for this client.
                </span>
              )}
              {summary?.today && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                  Scheduled Today
                </span>
              )}
              {summary?.thisWeek && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">
                  Scheduled Remaining This Week
                </span>
              )}
              {summary?.nextWeek && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
                  Scheduled Next Week
                </span>
              )}
              {summary?.notNext && !summary?.nextWeek && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                  Scheduled This Week but Not Next Week
                </span>
              )}
            </div>
          )}
        </div>

        <SquareReviewCard />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <CardTitle>Selected Date</CardTitle>
                <CardDescription>
                  Week of {data ? `${formatDate(data.week_start)} – ${formatDate(data.week_end)}` : "—"}
                  {data && (
                    <>
                      {" "}· Next week {formatDate(data.next_week_start)} – {formatDate(data.next_week_end)}
                    </>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value || todayYmd())}
                    className="w-44"
                  />
                </div>
                <Button variant="outline" onClick={() => setDate(todayYmd())}>
                  Today
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            {query.isLoading && <div>Loading…</div>}
            {query.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                Failed to load: {(query.error as Error).message}
              </div>
            )}
            {data?.error && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Square API: {data.error}
              </div>
            )}
            {data && (
              <div>
                Fetched {data.fetched_count} bookings · {data.unmatched.length} unmatched
              </div>
            )}
          </CardContent>
        </Card>

        <ScheduleSection
          title="Today"
          description={data ? formatDate(data.selected_date) : ""}
          appointments={data?.selected_day ?? []}
          defaultOpen
          showCheckIn
          checkedInIds={effectiveCheckedIn}
          onCheckIn={(clientId, bookingId, startAt) => completeMut.mutate({ clientId, bookingId, startAt })}
          completingBookingId={
            completeMut.isPending ? completeMut.variables?.bookingId ?? null : null
          }
          groupBy="time"
          filter={q}
          hideOwed={isStaff}
        />

        <ScheduleSection
          title="Remaining This Week"
          description={
            data
              ? `After ${formatDate(data.selected_date)} — through ${formatDate(data.week_end)}`
              : ""
          }
          appointments={remainingThisWeek}
          defaultOpen={false}
          groupBy="dayTime"
          filter={q}
          hideOwed={isStaff}
        />

        <ScheduleSection
          title="Next Week"
          description={
            data ? `${formatDate(data.next_week_start)} – ${formatDate(data.next_week_end)}` : ""
          }
          appointments={nextWeekAppts}
          defaultOpen={false}
          groupBy="dayTime"
          filter={q}
          hideOwed={isStaff}
        />

        <NotNextWeekSection
          appointments={thisWeekNotNextWeek}
          filter={q}
        />


        <ClientsNeedingCard
          title="Not Scheduled After Selected Date"
          description="Active clients with visits remaining and no Square appointment after this date."
          clients={data?.not_scheduled_after ?? []}
          hideOwed={isStaff}
        />

        <UnmatchedAppointmentsCard appointments={data?.unmatched ?? []} />
      </div>
    </AppShell>
  );
}

function formatTimeLocal(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "—";
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function groupByTime(appts: ScheduleAppointment[]): { key: string; label: string; items: ScheduleAppointment[] }[] {
  const map = new Map<string, ScheduleAppointment[]>();
  for (const a of appts) {
    const key = a.start_at;
    const arr = map.get(key) ?? [];
    arr.push(a);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, items]) => ({ key, label: formatTimeLocal(key), items }));
}

function groupByDayThenTime(
  appts: ScheduleAppointment[],
): { day: string; groups: { key: string; label: string; items: ScheduleAppointment[] }[] }[] {
  const byDay = new Map<string, ScheduleAppointment[]>();
  for (const a of appts) {
    const day = a.start_at.slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(a);
    byDay.set(day, arr);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, items]) => ({ day, groups: groupByTime(items) }));
}

function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dt.getDay()];
  return `${dow} ${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

function matchesSearch(a: ScheduleAppointment, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  const clientName = a.client
    ? `${a.client.first_name} ${a.client.last_name}`.toLowerCase()
    : "";
  const custName = a.customer_info
    ? `${a.customer_info.given_name ?? ""} ${a.customer_info.family_name ?? ""}`.toLowerCase()
    : "";
  const tm = (a.team_member_name ?? "").toLowerCase();
  return clientName.includes(s) || custName.includes(s) || tm.includes(s);
}

function ScheduleSection({
  title,
  description,
  appointments,
  defaultOpen,
  showCheckIn = false,
  checkedInIds,
  onCheckIn,
  completingBookingId,
  groupBy = "time",
  filter = "",
  hideOwed = false,
}: {
  title: string;
  description: string;
  appointments: ScheduleAppointment[];
  defaultOpen: boolean;
  showCheckIn?: boolean;
  checkedInIds?: Set<string>;
  onCheckIn?: (clientId: string, bookingId: string, startAt?: string) => void;
  completingBookingId?: string | null;
  groupBy?: "time" | "dayTime";
  filter?: string;
  hideOwed?: boolean;
}) {
  const checkedSet = checkedInIds ?? new Set<string>();
  const q = filter.trim();
  const filtered = q ? appointments.filter((a) => matchesSearch(a, q)) : appointments;
  const checkedCount = filtered.reduce(
    (n, a) => (checkedSet.has(a.booking_id) ? n + 1 : n),
    0,
  );
  const flatGroups = groupByTime(filtered);
  const now = Date.now();
  const nextGroupKey = showCheckIn
    ? flatGroups.find(
        (g) =>
          new Date(g.key).getTime() >= now &&
          g.items.some((a) => !checkedSet.has(a.booking_id)),
      )?.key ?? null
    : null;
  const dayGroups = groupBy === "dayTime" ? groupByDayThenTime(filtered) : null;
  const isOpen = defaultOpen || (q.length > 0 && filtered.length > 0);

  return (
    <Card>
      <details open={isOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6">
          <div className="min-w-0">
            <CardTitle>
              {title}{" "}
              <span className="text-sm font-normal text-slate-500">
                ({filtered.length}
                {checkedCount > 0 ? ` · ${checkedCount} checked in` : ""}
                {q && filtered.length !== appointments.length
                  ? ` · filtered from ${appointments.length}`
                  : ""}
                )
              </span>
            </CardTitle>
            {description && (
              <CardDescription className="mt-1">{description}</CardDescription>
            )}
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-6 pb-6">
          {filtered.length === 0 ? (
            <EmptyState
              text={q ? "No scheduled appointments found for this client." : "No appointments."}
            />
          ) : dayGroups ? (
            <div className="space-y-6">
              {dayGroups.map(({ day, groups }) => (
                <div key={day}>
                  <div className="mb-3 border-b border-slate-300 pb-1 text-base font-semibold text-slate-900">
                    {formatDayHeader(day)}
                  </div>
                  <div className="space-y-4">
                    {groups.map((g) => (
                      <TimeGroupBlock
                        key={g.key}
                        timeLabel={g.label}
                        appointments={g.items}
                        isNext={false}
                        showCheckIn={showCheckIn}
                        onCheckIn={onCheckIn}
                        completingBookingId={completingBookingId ?? null}
                        checkedInIds={checkedSet}
                        hideOwed={hideOwed}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {flatGroups.map((g) => (
                <TimeGroupBlock
                  key={g.key}
                  timeLabel={g.label}
                  appointments={g.items}
                  isNext={g.key === nextGroupKey}
                  showCheckIn={showCheckIn}
                  onCheckIn={onCheckIn}
                  completingBookingId={completingBookingId ?? null}
                  checkedInIds={checkedSet}
                  hideOwed={hideOwed}
                />
              ))}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

function TimeGroupBlock({
  timeLabel,
  appointments,
  isNext,
  showCheckIn,
  onCheckIn,
  completingBookingId,
  checkedInIds,
  hideOwed = false,
}: {
  timeLabel: string;
  appointments: ScheduleAppointment[];
  isNext: boolean;
  showCheckIn: boolean;
  onCheckIn?: (clientId: string, bookingId: string, startAt?: string) => void;
  completingBookingId: string | null;
  checkedInIds?: Set<string>;
  hideOwed?: boolean;
}) {
  const checkedSet = checkedInIds ?? new Set<string>();
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-1">
        <div className="text-sm font-semibold text-slate-800">{timeLabel}</div>
        {isNext && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
            Next
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {appointments.length} appt{appointments.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Mobile card list */}
      <div className="space-y-2 md:hidden">
        {appointments.map((a) => (
          <AppointmentMobileCard
            key={a.booking_id}
            appointment={a}
            isNext={isNext}
            showCheckIn={showCheckIn}
            onCheckIn={onCheckIn}
            completingBookingId={completingBookingId}
            isCheckedIn={checkedSet.has(a.booking_id)}
            hideOwed={hideOwed}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <AppointmentDesktopRow
                key={a.booking_id}
                appointment={a}
                isNext={isNext}
                showCheckIn={showCheckIn}
                onCheckIn={onCheckIn}
                completingBookingId={completingBookingId}
                isCheckedIn={checkedSet.has(a.booking_id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AppointmentMobileCard({
  appointment: a,
  isNext,
  showCheckIn,
  onCheckIn,
  completingBookingId,
  isCheckedIn,
  hideOwed = false,
}: {
  appointment: ScheduleAppointment;
  isNext: boolean;
  showCheckIn: boolean;
  onCheckIn?: (clientId: string, bookingId: string, startAt?: string) => void;
  completingBookingId: string | null;
  isCheckedIn: boolean;
  hideOwed?: boolean;
}) {
  const total = a.client?.package_total_visits ?? 0;
  const used = a.client?.visits_used ?? 0;
  const hasPackage = !!a.client && total > 0;
  const payPerVisit = a.client?.payment_model === "pay_per_visit";
  const noPackage = !!a.client && total === 0;
  const checkedInLabel = payPerVisit
    ? "✓ Checked In — Pay Per Visit"
    : noPackage
      ? "✓ Checked In — No Package Info"
      : "✓ Checked In";
  const packageComplete = hasPackage && !payPerVisit && used >= total;
  const owed = a.client
    ? Math.max(0, Number(a.client.package_price ?? 0) - Number(a.client.amount_paid ?? 0))
    : 0;
  const busy = completingBookingId === a.booking_id;

  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-sm ${
        isCheckedIn
          ? "border-emerald-300 bg-emerald-50/40"
          : isNext
            ? "border-emerald-400 ring-2 ring-emerald-200"
            : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-base font-semibold">
            {a.client ? (
              `${a.client.first_name} ${a.client.last_name}`
            ) : (
              <span className="text-amber-800">Unmatched booking</span>
            )}
          </div>
          {isCheckedIn && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
              {checkedInLabel}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {a.service_name ?? (a.duration_minutes ? `${a.duration_minutes} min` : "—")}
          {" · "}
          {a.status}
        </div>
        {a.team_member_name && (
          <div className="mt-0.5 text-xs text-slate-600">
            Scheduled with: <span className="font-medium">{a.team_member_name}</span>
          </div>
        )}
      </div>
      {a.client && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
            {hasPackage ? `${used}/${total} visits` : "No visit package"}
          </span>
          {owed > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
              {hideOwed ? "OWES" : `Owes ${formatCurrency(owed)}`}
            </span>
          )}
          {packageComplete && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
              Package complete
            </span>
          )}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {a.client ? (
          <>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link to="/clients/$id" params={{ id: a.client.id }}>
                View
              </Link>
            </Button>
            {showCheckIn && onCheckIn && !packageComplete ? (
              <Button
                size="lg"
                className="h-11"
                disabled={busy || isCheckedIn}
                onClick={() => onCheckIn(a.client!.id, a.booking_id, a.start_at)}
              >
                {isCheckedIn ? checkedInLabel : busy ? "…" : "✓ Check in"}
              </Button>
            ) : (
              <div />
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              const key = a.square_customer_id ?? a.booking_id;
              const el = document.getElementById(`unmatched-${key}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-amber-400");
                setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 1600);
              }
            }}
            className="col-span-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800"
          >
            Resolve Unmatched ↓
          </button>
        )}
      </div>
    </div>
  );
}

function AppointmentDesktopRow({
  appointment: a,
  isNext,
  showCheckIn,
  onCheckIn,
  completingBookingId,
  isCheckedIn,
}: {
  appointment: ScheduleAppointment;
  isNext: boolean;
  showCheckIn: boolean;
  onCheckIn?: (clientId: string, bookingId: string, startAt?: string) => void;
  completingBookingId: string | null;
  isCheckedIn: boolean;
}) {
  const total = a.client?.package_total_visits ?? 0;
  const used = a.client?.visits_used ?? 0;
  const hasPackage = !!a.client && total > 0;
  const payPerVisit = a.client?.payment_model === "pay_per_visit";
  const noPackage = !!a.client && total === 0;
  const checkedInLabel = payPerVisit
    ? "✓ Checked In — Pay Per Visit"
    : noPackage
      ? "✓ Checked In — No Package Info"
      : "✓ Checked In";
  const packageComplete = hasPackage && !payPerVisit && used >= total;
  const owed = a.client
    ? Math.max(0, Number(a.client.package_price ?? 0) - Number(a.client.amount_paid ?? 0))
    : 0;
  const busy = completingBookingId === a.booking_id;

  return (
    <TableRow
      className={
        isCheckedIn ? "bg-emerald-50/40" : isNext ? "bg-emerald-50/60" : undefined
      }
    >
      <TableCell className="text-sm">
        {a.client ? (
          <div>
            <div className="font-medium whitespace-nowrap">
              {isCheckedIn ? (
                <span className="mr-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                  {checkedInLabel}
                </span>
              ) : (
                isNext && (
                  <span className="mr-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                    Next
                  </span>
                )
              )}
              {a.client.first_name} {a.client.last_name}
              {owed > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                  OWES
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              {hasPackage ? `${used}/${total} visits` : "No visit package"}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              const key = a.square_customer_id ?? a.booking_id;
              const el = document.getElementById(`unmatched-${key}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-amber-400");
                setTimeout(() => el.classList.remove("ring-2", "ring-amber-400"), 1600);
              }
            }}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 hover:underline"
          >
            Unmatched ↓
          </button>
        )}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {a.service_name ?? (a.duration_minutes ? `${a.duration_minutes} min` : "—")}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap text-slate-600">
        {a.team_member_name ?? <span className="text-slate-400">—</span>}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        {isCheckedIn ? (
          <span className="font-semibold text-emerald-700">Checked In</span>
        ) : (
          a.status
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {a.client ? (
          <div className="inline-flex flex-col items-end gap-1">
            <div className="inline-flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/clients/$id" params={{ id: a.client.id }}>
                  View Client
                </Link>
              </Button>
              {showCheckIn && onCheckIn && !packageComplete && (
                <Button
                  size="sm"
                  disabled={busy || isCheckedIn}
                  onClick={() => onCheckIn(a.client!.id, a.booking_id, a.start_at)}
                >
                  {isCheckedIn ? checkedInLabel : busy ? "Recording…" : "Check In"}
                </Button>
              )}
            </div>
            {packageComplete && (
              <span className="text-[11px] text-amber-700">
                ⚠ Package complete — verify before recording another visit.
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}


function formatPhoneLink(s: string | null | undefined): string {
  if (!s) return "";
  const digits = s.replace(/\D+/g, "");
  if (!digits) return "";
  // If 10 digits, add US country code
  const num = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") && digits.length === 11 ? `+${digits}` : digits;
  return num;
}

function formatPhoneDisplay(s: string | null | undefined): string {
  if (!s) return "";
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s;
}

function normNameForDup(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function normPhoneForDup(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.replace(/\D+/g, "");
  if (!d) return null;
  return d.length > 10 ? d.slice(-10) : d;
}

function UnmatchedAppointmentsCard({ appointments }: { appointments: ScheduleAppointment[] }) {
  const { isStaff } = useRole();
  const listFn = useServerFn(listLinkableClients);
  const linkFn = useServerFn(linkSquareCustomer);
  const createFn = useServerFn(createClientFromSquareCustomer);
  const qc = useQueryClient();
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const clientsQuery = useQuery({
    queryKey: ["linkable-clients"],
    queryFn: () => listFn(),
    enabled: appointments.length > 0,
  });

  const linkMut = useMutation({
    mutationFn: (vars: { clientId: string; squareCustomerId: string }) =>
      linkFn({ data: vars }),
    onSuccess: () => {
      toast.success("Square customer linked");
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["linkable-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: (vars: {
      squareCustomerId: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string | null;
    }) => createFn({ data: vars }),
    onSuccess: () => {
      toast.success("Client created and linked to Square");
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["linkable-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  // Build normalized-name and normalized-phone lookup maps from Admin clients
  const { byName, byPhone } = useMemo(() => {
    const byName = new Map<string, LinkableClient[]>();
    const byPhone = new Map<string, LinkableClient[]>();
    for (const c of clientsQuery.data ?? []) {
      const nm = normNameForDup(`${c.first_name} ${c.last_name}`);
      if (nm) {
        const arr = byName.get(nm) ?? [];
        arr.push(c);
        byName.set(nm, arr);
      }
      const ph = normPhoneForDup(c.phone);
      if (ph) {
        const arr = byPhone.get(ph) ?? [];
        arr.push(c);
        byPhone.set(ph, arr);
      }
    }
    return { byName, byPhone };
  }, [clientsQuery.data]);

  // Group appointments by Square customer ID so the same person isn't linked twice in a row.
  const grouped = useMemo(() => {
    const m = new Map<string, ScheduleAppointment[]>();
    for (const a of appointments) {
      const key = a.square_customer_id ?? `__no_id_${a.booking_id}`;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [appointments]);

  const visible = grouped.filter(([key]) => !ignored.has(key));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unmatched Appointments</CardTitle>
        <CardDescription>
          Production Square bookings whose customer ID isn't linked to an Admin client. Link them
          here so future appointments and payments match automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <EmptyState text="All bookings match an Admin client." />
        ) : visible.length === 0 ? (
          <EmptyState text="All unmatched bookings ignored in this session." />
        ) : (
          <div className="space-y-3">
            {visible.map(([key, group]) => {
              const first = group[0];
              const info = first.customer_info;
              const fullName = [info?.given_name, info?.family_name].filter(Boolean).join(" ").trim();
              const anchorKey = first.square_customer_id ?? first.booking_id;
              const linkedElsewhere =
                first.square_customer_id && (clientsQuery.data ?? []).find(
                  (c) => c.square_customer_id === first.square_customer_id,
                );

              // Possible-duplicate detection: same normalized name OR same phone
              // as an existing Admin client. Skip anything already linked to
                // *this* Square customer (that's handled by linkedElsewhere).
              const nameKey = normNameForDup(fullName);
              const phoneKey = normPhoneForDup(info?.phone);
              const dupSet = new Map<string, LinkableClient>();
              if (nameKey) for (const c of byName.get(nameKey) ?? []) dupSet.set(c.id, c);
              if (phoneKey) for (const c of byPhone.get(phoneKey) ?? []) dupSet.set(c.id, c);
              // Never surface the exact-linked client as a "possible duplicate"
              if (linkedElsewhere) dupSet.delete(linkedElsewhere.id);
              const duplicates = Array.from(dupSet.values());

              return (
                <div
                  key={key}
                  id={`unmatched-${anchorKey}`}
                  className="scroll-mt-24 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm transition-shadow"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-slate-900">
                        {fullName || <span className="text-slate-500">Unknown name</span>}
                      </div>
                      <div className="text-xs text-slate-600">
                        <span className="text-slate-400">Email: </span>
                        {info?.email ?? <span className="italic text-slate-400">none</span>}
                        {" · "}
                        <span className="text-slate-400">Phone: </span>
                        {info?.phone ?? <span className="italic text-slate-400">none</span>}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Square customer ID: {first.square_customer_id ?? "— (booking has no customer)"}
                      </div>
                      <div className="text-[11px]">
                        {!first.square_customer_id ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                            Square booking has no customer_id — can't be linked
                          </span>
                        ) : linkedElsewhere ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                            ⚠ Already linked to {linkedElsewhere.first_name}{" "}
                            {linkedElsewhere.last_name} — refresh Schedule Check
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                            No Admin client has this Square customer ID
                          </span>
                        )}
                      </div>
                    </div>
                    {first.square_customer_id && !linkedElsewhere && (
                      <div className="flex flex-col items-end gap-2">
                        <LinkClientControl
                          clients={clientsQuery.data ?? []}
                          loading={clientsQuery.isLoading}
                          disabled={linkMut.isPending || createMut.isPending}
                          onLink={(clientId) =>
                            linkMut.mutate({
                              clientId,
                              squareCustomerId: first.square_customer_id!,
                            })
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={createMut.isPending || !fullName}
                          title={
                            fullName
                              ? "Creates a new client with this Square customer's name, phone and email, already linked"
                              : "Square has no name for this customer — create the client manually"
                          }
                          onClick={() => {
                            const parts = fullName.split(/\s+/);
                            const firstName = info?.given_name ?? parts[0] ?? "";
                            const lastName =
                              info?.family_name ?? parts.slice(1).join(" ") ?? "";
                            if (
                              duplicates.length > 0 &&
                              !window.confirm(
                                `A possible duplicate already exists (${duplicates
                                  .map((c) => `${c.first_name} ${c.last_name}`)
                                  .join(", ")}). Create a new client anyway?`,
                              )
                            ) {
                              return;
                            }
                            createMut.mutate({
                              squareCustomerId: first.square_customer_id!,
                              firstName,
                              lastName,
                              phone: info?.phone ?? null,
                              email: info?.email ?? null,
                            });
                          }}
                        >
                          {createMut.isPending ? "Creating…" : "Create client from Square"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {duplicates.length > 0 && first.square_customer_id && !linkedElsewhere && (
                    <div className="mt-3 rounded-md border border-orange-300 bg-orange-50 p-3">
                      <div className="text-sm font-semibold text-orange-900">
                        ⚠ Possible duplicate client already exists
                      </div>
                      <div className="mt-1 text-xs text-orange-800">
                        Matched on{" "}
                        {[
                          nameKey && (byName.get(nameKey) ?? []).length > 0 ? "name" : null,
                          phoneKey && (byPhone.get(phoneKey) ?? []).length > 0 ? "phone" : null,
                        ]
                          .filter(Boolean)
                          .join(" + ") || "contact info"}
                        .
                      </div>
                      <div className="mt-2 space-y-2">
                        {duplicates.map((c) => {
                          const remaining = visitsRemaining(c);
                          const owed = Math.max(
                            0,
                            Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0),
                          );
                          const isArchived =
                            (c.status ?? "active").toLowerCase() !== "active";
                          return (
                            <div
                              key={c.id}
                              className="rounded border border-orange-200 bg-white p-2 text-xs"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="font-medium text-slate-900">
                                    <Link
                                      to="/clients/$id"
                                      params={{ id: c.id }}
                                      className="underline"
                                    >
                                      {c.first_name} {c.last_name}
                                    </Link>
                                    <span
                                      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                        isArchived
                                          ? "bg-slate-200 text-slate-700"
                                          : "bg-emerald-100 text-emerald-900"
                                      }`}
                                    >
                                      {isArchived ? c.status ?? "archived" : "active"}
                                    </span>
                                  </div>
                                  <div className="text-slate-600">
                                    <span className="text-slate-400">Phone: </span>
                                    {c.phone ?? "—"}
                                    {" · "}
                                    <span className="text-slate-400">Email: </span>
                                    {c.email ?? "—"}
                                  </div>
                                  <div className="font-mono text-[10px] text-slate-500">
                                    Current square_customer_id:{" "}
                                    {c.square_customer_id ?? (
                                      <span className="italic text-slate-400">
                                        not linked
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-slate-600">
                                    {remaining}/{c.package_total_visits} visits left
                                    {!isStaff && (
                                      <>
                                        {" · "}
                                        {formatCurrency(Number(c.amount_paid ?? 0))} /{" "}
                                        {formatCurrency(Number(c.package_price ?? 0))}
                                        {owed > 0 && (
                                          <span className="text-red-700">
                                            {" · "}
                                            Owes {formatCurrency(owed)}
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <Button
                                    size="sm"
                                    disabled={
                                      linkMut.isPending || !!c.square_customer_id
                                    }
                                    onClick={() =>
                                      linkMut.mutate({
                                        clientId: c.id,
                                        squareCustomerId: first.square_customer_id!,
                                      })
                                    }
                                    title={
                                      c.square_customer_id
                                        ? "This Admin client is already linked to a different Square customer"
                                        : undefined
                                    }
                                  >
                                    Link Square customer to {c.first_name}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/clients/new">Create new Admin client</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setIgnored((prev) => {
                              const next = new Set(prev);
                              next.add(key);
                              return next;
                            })
                          }
                        >
                          Ignore
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="py-1 pr-3 font-medium">When</th>
                          <th className="py-1 pr-3 font-medium">Service</th>
                          <th className="py-1 pr-3 font-medium">Status</th>
                          <th className="py-1 pr-3 font-medium">Booking ID</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700">
                        {group.map((g) => (
                          <tr key={g.booking_id} className="border-t border-slate-200">
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {formatDateTimeLocal(g.start_at)}
                            </td>
                            <td className="py-1 pr-3">
                              {g.service_name ??
                                (g.duration_minutes ? `${g.duration_minutes} min` : "—")}
                            </td>
                            <td className="py-1 pr-3">{g.status}</td>
                            <td className="py-1 pr-3 font-mono text-[10px] text-slate-500">
                              {g.booking_id}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkClientControl({
  clients,
  loading,
  disabled,
  onLink,
}: {
  clients: LinkableClient[];
  loading: boolean;
  disabled: boolean;
  onLink: (clientId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients
      .filter((c) =>
        `${c.first_name} ${c.last_name} ${c.email ?? ""} ${c.phone ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50);
  }, [clients, query]);

  return (
    <div className="flex flex-col items-end gap-2">
      <Input
        placeholder="Search clients…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 w-56 text-xs"
      />
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={loading}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder={loading ? "Loading…" : "Select a client"} />
          </SelectTrigger>
          <SelectContent>
            {filtered.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.first_name} {c.last_name}
                {c.square_customer_id ? " (already linked)" : ""}
              </SelectItem>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-1 text-xs text-slate-500">No matches</div>
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!selected || disabled}
          onClick={() => selected && onLink(selected)}
        >
          Link
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function AppointmentsCard({
  title,
  description,
  appointments,
  showCompleteVisit = false,
  onCompleteVisit,
  completing,
}: {
  title: string;
  description: string;
  appointments: ScheduleAppointment[];
  showCompleteVisit?: boolean;
  onCompleteVisit?: (clientId: string) => void;
  completing?: string | null;
}) {
  const renewalFlags = useRenewalFlaggedClientIds().data;
  return (

    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <EmptyState text="No appointments." />
        ) : (
          <>
            {/* Mobile card list */}
            <div className="space-y-2 md:hidden">
              {(() => {
                const now = Date.now();
                const nextIdx = showCompleteVisit
                  ? appointments.findIndex((a) => new Date(a.start_at).getTime() >= now)
                  : -1;
                return appointments.map((a, i) => {
                  const remaining = a.client ? visitsRemaining(a.client) : 0;
                  const hasPackage = !!a.client && (a.client.package_total_visits ?? 0) > 0;
                  const visitsUnknown = hasPackage && remaining === null;
                  const visitsZero = hasPackage && remaining === 0;
                  const owed = a.client
                    ? Math.max(
                        0,
                        Number(a.client.package_price ?? 0) - Number(a.client.amount_paid ?? 0),
                      )
                    : 0;
                  const isCurrent = i === nextIdx;
                  return (
                    <div
                      key={a.booking_id}
                      className={`rounded-xl border bg-white p-3 shadow-sm ${
                        isCurrent ? "border-emerald-400 ring-2 ring-emerald-200" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {isCurrent && (
                              <span className="mr-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                NEXT
                              </span>
                            )}
                            {formatDateTimeLocal(a.start_at)}
                          </div>
                          <div className="mt-1 truncate text-base font-semibold">
                            {a.client ? (
                              `${a.client.first_name} ${a.client.last_name}`
                            ) : (
                              <span className="text-amber-800">Unmatched booking</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {a.service_name ??
                              (a.duration_minutes ? `${a.duration_minutes} min` : "—")}
                            {" · "}
                            {a.status}
                          </div>
                        </div>
                      </div>
                      {a.client && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                          {renewalFlags?.has(a.client.id) && <RenewalFlagBadge />}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">

                            {remaining === null
                              ? "Visits unknown"
                              : `${remaining}/${a.client.package_total_visits ?? 0} visits`}
                          </span>
                          {owed > 0 && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
                              Owes {formatCurrency(owed)}
                            </span>
                          )}
                          {visitsZero && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                              Package complete
                            </span>
                          )}
                          {visitsUnknown && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                              ⚠ Verify visits
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {a.client ? (
                          <>
                            <Button asChild size="lg" variant="outline" className="h-11">
                              <Link to="/clients/$id" params={{ id: a.client.id }}>
                                View
                              </Link>
                            </Button>
                            {showCompleteVisit && onCompleteVisit && !visitsZero ? (
                              <Button
                                size="lg"
                                className="h-11"
                                disabled={completing === a.client.id}
                                onClick={() => onCompleteVisit(a.client!.id)}
                              >
                                {completing === a.client.id ? "…" : "✓ Check in"}
                              </Button>
                            ) : (
                              <div />
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const key = a.square_customer_id ?? a.booking_id;
                              const el = document.getElementById(`unmatched-${key}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "start" });
                                el.classList.add("ring-2", "ring-amber-400");
                                setTimeout(
                                  () => el.classList.remove("ring-2", "ring-amber-400"),
                                  1600,
                                );
                              }
                            }}
                            className="col-span-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800"
                          >
                            Resolve Unmatched ↓
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Desktop table */}
            <div className="-mx-6 hidden overflow-x-auto px-6 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((a) => {
                  const remaining = a.client ? visitsRemaining(a.client) : 0;
                  const hasPackage = !!a.client && (a.client.package_total_visits ?? 0) > 0;
                  const visitsUnknown = hasPackage && remaining === null;
                  const visitsZero = hasPackage && remaining === 0;
                  return (
                    <TableRow key={a.booking_id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTimeLocal(a.start_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.client ? (
                          <div>
                            <div className="font-medium whitespace-nowrap">
                              {a.client.first_name} {a.client.last_name}
                            </div>
                            {renewalFlags?.has(a.client.id) && (
                              <div className="mt-0.5">
                                <RenewalFlagBadge />
                              </div>
                            )}
                            <div className="text-xs text-slate-500">
                              {remaining === null ? "Visits unknown" : `${remaining} visits left`}
                            </div>
                          </div>

                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const key = a.square_customer_id ?? a.booking_id;
                              const el = document.getElementById(`unmatched-${key}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "start" });
                                el.classList.add("ring-2", "ring-amber-400");
                                setTimeout(
                                  () => el.classList.remove("ring-2", "ring-amber-400"),
                                  1600,
                                );
                              }
                            }}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 underline-offset-2 hover:bg-amber-200 hover:underline"
                            title="Jump to Unmatched Appointments"
                          >
                            Unmatched ↓
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {a.service_name ?? (a.duration_minutes ? `${a.duration_minutes} min` : "—")}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{a.status}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {a.client ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <div className="inline-flex gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link to="/clients/$id" params={{ id: a.client.id }}>
                                  View Client
                                </Link>
                              </Button>
                              {showCompleteVisit && onCompleteVisit && !visitsZero && (
                                <Button
                                  size="sm"
                                  disabled={completing === a.client.id}
                                  onClick={() => onCompleteVisit(a.client!.id)}
                                  title={
                                    visitsUnknown
                                      ? "Visits unknown — verify before completing."
                                      : undefined
                                  }
                                >
                                  {completing === a.client.id ? "Recording…" : "Complete Visit"}
                                </Button>
                              )}
                            </div>
                            {visitsUnknown && (
                              <span className="text-[11px] text-amber-700">
                                ⚠ Visits unknown — verify before completing.
                              </span>
                            )}
                            {visitsZero && (
                              <span className="text-[11px] text-amber-700">
                                ⚠ Visits show 0 — verify in Square before completing.
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>

                    </TableRow>
                  );
                })}

              </TableBody>
            </Table>
            </div>
          </>
        )}
      </CardContent>

    </Card>

  );
}

function ClientsNeedingCard({
  title,
  description,
  clients,
  hideOwed = false,
}: {
  title: string;
  description: string;
  clients: NeedsScheduleClient[];
  hideOwed?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {clients.length === 0 ? (
          <EmptyState text="Nothing to follow up on." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Visits Left</TableHead>
                {!hideOwed && <TableHead>Owed</TableHead>}
                <TableHead>Last Appt</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => {
                const remaining = visitsRemaining(c);
                const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.first_name} {c.last_name}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{remaining}</TableCell>
                    {!hideOwed && <TableCell className="text-sm">{formatCurrency(owed)}</TableCell>}
                    <TableCell className="text-sm">
                      {c.last_appointment_at ? formatDate(c.last_appointment_at.slice(0, 10)) : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-slate-600">
                      {c.internal_notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/clients/$id" params={{ id: c.id }}>
                          View Client
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SquareReviewCard() {
  const [filter, setFilter] = useState<"relevant" | "hidden" | "all">("relevant");
  const listFn = useServerFn(listSquareCustomerReviews);
  const linkClientsFn = useServerFn(listLinkableClients);
  const linkReviewFn = useServerFn(linkSquareReview);
  const createFn = useServerFn(createClientFromSquareReview);
  const ignoreFn = useServerFn(ignoreSquareReview);
  const qc = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: ["square-reviews", filter],
    queryFn: () => listFn({ data: { filter } }),
  });

  const clientsQuery = useQuery({
    queryKey: ["linkable-clients"],
    queryFn: () => linkClientsFn(),
    enabled: (reviewsQuery.data?.length ?? 0) > 0,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["square-reviews"] });
    qc.invalidateQueries({ queryKey: ["linkable-clients"] });
    qc.invalidateQueries({ queryKey: ["schedule-check"] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const linkMut = useMutation({
    mutationFn: (vars: { reviewId: string; clientId: string }) => linkReviewFn({ data: vars }),
    onSuccess: () => {
      toast.success("Linked to Square customer");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: (reviewId: string) => createFn({ data: { reviewId } }),
    onSuccess: () => {
      toast.success("New client created and linked");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ignoreMut = useMutation({
    mutationFn: (reviewId: string) => ignoreFn({ data: { reviewId } }),
    onSuccess: () => {
      toast.success("Ignored");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviews = reviewsQuery.data ?? [];

  const tabs: { key: typeof filter; label: string }[] = [
    { key: "relevant", label: "Needs Review (Scheduled · Recent · Possible Match)" },
    { key: "hidden", label: "Hidden Old Customers" },
    { key: "all", label: "Show All" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs Review ({reviews.length})</CardTitle>
        <CardDescription>
          Production Square customers that couldn't be auto-linked. Only customers with a future
          appointment, a payment in the last 60 days, or a possible email/phone match are shown by
          default. Old, unmatched Square records are hidden — they aren't deleted.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {tabs.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={filter === t.key ? "default" : "outline"}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {reviewsQuery.isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : reviews.length === 0 ? (
          <EmptyState text="Nothing waiting for review." />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <ReviewRow
                key={r.id}
                review={r}
                clients={clientsQuery.data ?? []}
                clientsLoading={clientsQuery.isLoading}
                busy={linkMut.isPending || createMut.isPending || ignoreMut.isPending}
                onLink={(clientId) => linkMut.mutate({ reviewId: r.id, clientId })}
                onCreate={() => createMut.mutate(r.id)}
                onIgnore={() => ignoreMut.mutate(r.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const RELEVANCE_LABELS: Record<string, { label: string; className: string }> = {
  scheduled_future: { label: "Scheduled", className: "bg-emerald-100 text-emerald-900" },
  recent_payment: { label: "Recent Payment", className: "bg-blue-100 text-blue-900" },
  possible_match: { label: "Possible Match", className: "bg-amber-100 text-amber-900" },
  hidden_old: { label: "Hidden (Old)", className: "bg-slate-200 text-slate-700" },
};

function ReviewRow({
  review,
  clients,
  clientsLoading,
  busy,
  onLink,
  onCreate,
  onIgnore,
}: {
  review: SquareCustomerReview;
  clients: LinkableClient[];
  clientsLoading: boolean;
  busy: boolean;
  onLink: (clientId: string) => void;
  onCreate: () => void;
  onIgnore: () => void;
}) {
  const fullName = [review.given_name, review.family_name].filter(Boolean).join(" ").trim();
  const suggested = review.suggested_client;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium text-slate-900">
            {fullName || <span className="text-slate-500">Unknown name</span>}
          </div>
          <div className="text-xs text-slate-600">
            {review.email && <span>{review.email}</span>}
            {review.email && review.phone && " · "}
            {review.phone && <span>{review.phone}</span>}
            {!review.email && !review.phone && <span className="italic">No email or phone</span>}
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            Square ID: {review.square_customer_id}
          </div>
          <div className="text-xs flex flex-wrap gap-1">
            {(() => {
              const rel = RELEVANCE_LABELS[review.relevance] ?? RELEVANCE_LABELS.possible_match;
              return (
                <span className={`rounded-full px-2 py-0.5 font-medium ${rel.className}`}>
                  {rel.label}
                </span>
              );
            })()}
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
              {review.reason}
            </span>
          </div>
          {suggested && (
            <div className="text-xs text-slate-700">
              Suggested match:{" "}
              <Link
                to="/clients/$id"
                params={{ id: suggested.id }}
                className="font-medium text-slate-900 underline"
              >
                {suggested.first_name} {suggested.last_name}
              </Link>
              {(suggested.email || suggested.phone) && (
                <span className="text-slate-500">
                  {" "}
                  · {suggested.email ?? ""}
                  {suggested.email && suggested.phone ? " · " : ""}
                  {suggested.phone ?? ""}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {suggested && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onLink(suggested.id)}
            >
              Link to {suggested.first_name} {suggested.last_name}
            </Button>
          )}
          <LinkClientControl
            clients={clients}
            loading={clientsLoading}
            disabled={busy}
            onLink={onLink}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onCreate}>
              Create New Admin Client
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onIgnore}>
              Ignore
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotNextWeekSection({
  appointments,
  filter = "",
}: {
  appointments: ScheduleAppointment[];
  filter?: string;
}) {
  const q = filter.trim();
  const filtered = q ? appointments.filter((a) => matchesSearch(a, q)) : appointments;

  // Dedupe to one row per client, keeping earliest appointment this week.
  const perClient = useMemo(() => {
    const map = new Map<string, ScheduleAppointment>();
    for (const a of filtered) {
      if (!a.client) continue;
      const existing = map.get(a.client.id);
      if (!existing || a.start_at < existing.start_at) map.set(a.client.id, a);
    }
    return Array.from(map.values());
  }, [filtered]);

  const clientIds = useMemo(() => perClient.map((a) => a.client!.id), [perClient]);

  const fetchContacted = useServerFn(getContactedClientIds);
  const markContacted = useServerFn(markClientContacted);
  const unmarkContacted = useServerFn(unmarkClientContacted);
  const fetchUnavailable = useServerFn(getUnavailableNextWeekClientIds);
  const markUnavailable = useServerFn(markClientUnavailableNextWeek);
  const unmarkUnavailable = useServerFn(unmarkClientUnavailableNextWeek);
  const qc = useQueryClient();

  const contactedQuery = useQuery({
    queryKey: ["contacted-not-next-week", clientIds.slice().sort().join(",")],
    queryFn: () => fetchContacted({ data: { clientIds } }),
    enabled: clientIds.length > 0,
    staleTime: 60_000,
  });

  const unavailableQuery = useQuery({
    queryKey: ["unavailable-next-week", clientIds.slice().sort().join(",")],
    queryFn: () => fetchUnavailable({ data: { clientIds } }),
    enabled: clientIds.length > 0,
    staleTime: 60_000,
  });

  const contactedSet = useMemo(
    () => new Set<string>(contactedQuery.data?.client_ids ?? []),
    [contactedQuery.data],
  );
  const priorContactedSet = useMemo(
    () => new Set<string>(contactedQuery.data?.prior_client_ids ?? []),
    [contactedQuery.data],
  );
  const unavailableSet = useMemo(
    () => new Set<string>(unavailableQuery.data?.client_ids ?? []),
    [unavailableQuery.data],
  );

  const markMut = useMutation({
    mutationFn: (clientId: string) => markContacted({ data: { clientId } }),
    onSuccess: (_r, clientId) => {
      toast.success("Marked as contacted");
      qc.setQueriesData<
        { client_ids: string[]; prior_client_ids?: string[]; week_start?: string } | undefined
      >({ queryKey: ["contacted-not-next-week"] }, (prev) => {
        const cur = new Set(prev?.client_ids ?? []);
        cur.add(clientId);
        const prior = new Set(prev?.prior_client_ids ?? []);
        prior.delete(clientId);
        return {
          client_ids: Array.from(cur),
          prior_client_ids: Array.from(prior),
          week_start: prev?.week_start ?? "",
        };
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [undoArmedFor, setUndoArmedFor] = useState<string | null>(null);
  const unmarkMut = useMutation({
    mutationFn: (clientId: string) => unmarkContacted({ data: { clientId } }),
    onSuccess: (_r, clientId) => {
      toast.success("Reverted — marked as not contacted");
      setUndoArmedFor((cur) => (cur === clientId ? null : cur));
      qc.setQueriesData<
        { client_ids: string[]; prior_client_ids?: string[]; week_start?: string } | undefined
      >({ queryKey: ["contacted-not-next-week"] }, (prev) => {
        const cur = new Set(prev?.client_ids ?? []);
        cur.delete(clientId);
        return {
          client_ids: Array.from(cur),
          prior_client_ids: prev?.prior_client_ids ?? [],
          week_start: prev?.week_start ?? "",
        };
      });
      qc.invalidateQueries({ queryKey: ["contacted-not-next-week"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  const unavailableMut = useMutation({
    mutationFn: (vars: { clientId: string; reason: string }) =>
      markUnavailable({ data: { clientId: vars.clientId, reason: vars.reason } }),
    onSuccess: (_r, vars) => {
      toast.success("Marked unavailable next week");
      setReasonFor(null);
      setReasonText("");
      qc.setQueriesData<{ client_ids: string[] } | undefined>(
        { queryKey: ["unavailable-next-week"] },
        (prev) => {
          const cur = new Set(prev?.client_ids ?? []);
          cur.add(vars.clientId);
          return { client_ids: Array.from(cur) };
        },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [undoUnavailableArmedFor, setUndoUnavailableArmedFor] = useState<string | null>(null);
  const unmarkUnavailableMut = useMutation({
    mutationFn: (clientId: string) => unmarkUnavailable({ data: { clientId } }),
    onSuccess: (_r, clientId) => {
      toast.success("Reverted — no longer marked unavailable");
      setUndoUnavailableArmedFor((cur) => (cur === clientId ? null : cur));
      qc.setQueriesData<{ client_ids: string[] } | undefined>(
        { queryKey: ["unavailable-next-week"] },
        (prev) => {
          const cur = new Set(prev?.client_ids ?? []);
          cur.delete(clientId);
          return { client_ids: Array.from(cur) };
        },
      );
      qc.invalidateQueries({ queryKey: ["unavailable-next-week"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  // Sort: active first, then contacted, then unavailable at the bottom.
  const sorted = useMemo(() => {
    const rank = (id: string) => {
      if (unavailableSet.has(id)) return 2;
      if (contactedSet.has(id)) return 1;
      return 0;
    };
    return [...perClient].sort((a, b) => {
      const ra = rank(a.client!.id);
      const rb = rank(b.client!.id);
      if (ra !== rb) return ra - rb;
      return a.start_at.localeCompare(b.start_at);
    });
  }, [perClient, contactedSet, unavailableSet]);

  const isOpen = q.length > 0 && sorted.length > 0;
  const contactedCount = sorted.reduce(
    (n, a) => (contactedSet.has(a.client!.id) ? n + 1 : n),
    0,
  );
  const unavailableCount = sorted.reduce(
    (n, a) => (unavailableSet.has(a.client!.id) ? n + 1 : n),
    0,
  );

  return (
    <Card>
      <details open={isOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6">
          <div className="min-w-0">
            <CardTitle>
              Scheduled This Week But Not Next Week{" "}
              <span className="text-sm font-normal text-slate-500">
                ({sorted.length}
                {contactedCount > 0 ? ` · ${contactedCount} contacted` : ""}
                {unavailableCount > 0 ? ` · ${unavailableCount} unavailable` : ""})
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              Clients with an appointment this week but nothing on the books next week —
              good candidates to re-book. Once a client books next week, they drop out of
              this list automatically.
            </CardDescription>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-6 pb-6">
          {sorted.length === 0 ? (
            <EmptyState
              text={q ? "No scheduled appointments found for this client." : "No clients."}
            />
          ) : (
            <div className="space-y-2">
              {sorted.map((a) => {
                const c = a.client!;
                const isContacted = contactedSet.has(c.id);
                const wasContactedPrior = priorContactedSet.has(c.id);
                const isUnavailable = unavailableSet.has(c.id);
                const busy = markMut.isPending && markMut.variables === c.id;
                const unavailBusy =
                  unavailableMut.isPending && unavailableMut.variables?.clientId === c.id;
                const showReasonInput = reasonFor === c.id;
                return (
                  <div
                    key={c.id}
                    className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3 shadow-sm ${
                      isUnavailable
                        ? "border-slate-200 bg-slate-100/70 opacity-70"
                        : isContacted
                          ? "border-emerald-300 bg-emerald-50/40"
                          : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm font-semibold ${
                          isUnavailable ? "text-slate-500" : "text-slate-900"
                        }`}
                      >
                        {c.first_name} {c.last_name}
                        {isUnavailable && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                            Not available next week
                          </span>
                        )}
                        {!isUnavailable && !isContacted && wasContactedPrior && (
                          <span
                            className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                            title="This client has a 'contacted' entry from a previous week."
                          >
                            Already contacted last week
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span>
                          {formatDayHeader(a.start_at.slice(0, 10))} · {formatTimeLocal(a.start_at)}
                          {a.team_member_name ? ` · ${a.team_member_name}` : ""}
                        </span>
                        {c.phone && !isUnavailable && (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={`tel:${formatPhoneLink(c.phone)}`}
                              className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-sky-700 hover:bg-sky-100 hover:underline"
                              title="Call"
                            >
                              <Phone className="h-3 w-3" />
                              <span className="hidden sm:inline">{formatPhoneDisplay(c.phone)}</span>
                            </a>
                            <a
                              href={`sms:${formatPhoneLink(c.phone)}`}
                              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-100 hover:underline"
                              title="Text"
                            >
                              <MessageSquare className="h-3 w-3" />
                              <span className="hidden sm:inline">Text</span>
                            </a>
                          </span>
                        )}
                      </div>
                      {showReasonInput && !isUnavailable && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            unavailableMut.mutate({ clientId: c.id, reason: reasonText });
                          }}
                          className="mt-2 flex flex-wrap items-center gap-2"
                        >
                          <Input
                            autoFocus
                            placeholder="Reason (optional) — vacation, moving…"
                            value={reasonText}
                            onChange={(e) => setReasonText(e.target.value)}
                            className="h-8 max-w-xs text-xs"
                          />
                          <Button type="submit" size="sm" disabled={unavailBusy}>
                            {unavailBusy ? "…" : "Confirm"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReasonFor(null);
                              setReasonText("");
                            }}
                          >
                            Cancel
                          </Button>
                        </form>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/clients/$id" params={{ id: c.id }}>
                          View
                        </Link>
                      </Button>
                      {isUnavailable && (() => {
                        const undoBusy =
                          unmarkUnavailableMut.isPending &&
                          unmarkUnavailableMut.variables === c.id;
                        const armed = undoUnavailableArmedFor === c.id;
                        return (
                          <Button
                            size="sm"
                            variant="ghost"
                            className={
                              armed
                                ? "text-red-700 hover:text-red-800 hover:bg-red-50"
                                : "text-slate-500 hover:text-slate-700"
                            }
                            disabled={undoBusy}
                            onClick={() => {
                              if (undoBusy) return;
                              if (armed) {
                                unmarkUnavailableMut.mutate(c.id);
                              } else {
                                setUndoUnavailableArmedFor(c.id);
                                window.setTimeout(() => {
                                  setUndoUnavailableArmedFor((cur) =>
                                    cur === c.id ? null : cur,
                                  );
                                }, 4000);
                              }
                            }}
                            title="Delete the 'unavailable next week' entry and return this client to the actionable list"
                          >
                            {undoBusy ? "…" : armed ? "Tap again to confirm" : "Undo"}
                          </Button>
                        );
                      })()}

                      {!isUnavailable && (
                        <>
                          <Button
                            size="sm"
                            disabled={isContacted || busy}
                            onClick={() => markMut.mutate(c.id)}
                          >
                            {isContacted ? "Contacted ✓" : busy ? "…" : "Mark as Contacted"}
                          </Button>
                          {isContacted && (
                            (() => {
                              const undoBusy =
                                unmarkMut.isPending && unmarkMut.variables === c.id;
                              const armed = undoArmedFor === c.id;
                              return (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={
                                    armed
                                      ? "text-red-700 hover:text-red-800 hover:bg-red-50"
                                      : "text-slate-500 hover:text-slate-700"
                                  }
                                  disabled={undoBusy}
                                  onClick={() => {
                                    if (undoBusy) return;
                                    if (armed) {
                                      unmarkMut.mutate(c.id);
                                    } else {
                                      setUndoArmedFor(c.id);
                                      window.setTimeout(() => {
                                        setUndoArmedFor((cur) => (cur === c.id ? null : cur));
                                      }, 4000);
                                    }
                                  }}
                                  title="Delete this week's 'contacted' entry and revert to 'Mark as Contacted'"
                                >
                                  {undoBusy
                                    ? "…"
                                    : armed
                                      ? "Tap again to confirm"
                                      : "Undo"}
                                </Button>
                              );
                            })()
                          )}
                          {!showReasonInput && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReasonFor(c.id);
                                setReasonText("");
                              }}
                            >
                              Can't be scheduled next week
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}


