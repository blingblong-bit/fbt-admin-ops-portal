import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  CircleSlash,
  History,
  Hourglass,
  Receipt,
  Users,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SmartClientCard } from "@/components/SmartClientCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  amountOwed,
  effectiveStatus,
  formatCurrency,
  fullName,
  visitsRemaining,
  type Client,
  type LifecycleStatus,
} from "@/lib/clients";
import {
  getScheduledClientIds,
  getThisWeekScheduledClientIds,
  getNextWeekScheduledClientIds,
  getPriorWeeksScheduledClientLastDates,
} from "@/lib/schedule.functions";
import type { ScheduleStatus } from "@/components/SmartClientCard";
import { useRole } from "@/hooks/useRole";


export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · FIT Beyond Therapy Admin" }] }),
  component: Dashboard,
});

function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      // PostgREST caps a single response at 1000 rows. Page through with
      // .range() so dashboard tiles (Payment Due, etc.) see every client,
      // not just the most recently updated 1000.
      const PAGE_SIZE = 1000;
      const all: Client[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from("clients")
          .select("*")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .range(from, to);
        if (error) {
          // If a later page fails, surface the error rather than silently
          // showing a partial dashboard.
          if (all.length === 0) throw error;
          throw new Error(
            `Loaded ${all.length} clients before pagination failed: ${error.message}`,
          );
        }
        const batch = (data ?? []) as unknown as Client[];
        all.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }
      return all;
    },
  });
}

type FilterKey =
  | "all"
  | "payment_due"
  | "payment_due_this_week"
  | "payment_due_next_week"
  | "overdue_prior_weeks"
  | "not_scheduled"
  | "almost_finished"
  | "critical"
  | "package_complete";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All Active",
  payment_due: "Payment Due",
  payment_due_this_week: "Payment Due — This Week",
  payment_due_next_week: "Payment Due — Next Week",
  overdue_prior_weeks: "Overdue — Prior Weeks",
  not_scheduled: "Not Scheduled",
  almost_finished: "Almost Finished",
  critical: "Critical",
  package_complete: "Package Complete",
};

type StatusFilter = "active_assessment" | "active" | "assessment" | "archived" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  active_assessment: "Active + Assessment",
  active: "Active only",
  assessment: "Assessment only",
  archived: "Archived only",
  all: "All (incl. archived)",
};

function matchesStatus(eff: LifecycleStatus, f: StatusFilter): boolean {
  switch (f) {
    case "active_assessment":
      return eff === "active" || eff === "assessment";
    case "active":
      return eff === "active";
    case "assessment":
      return eff === "assessment";
    case "archived":
      return eff === "archived";
    case "all":
      return true;
  }
}

function matchesFilter(
  c: Client,
  f: FilterKey,
  isScheduled: boolean,
  isScheduledThisWeek: boolean,
  isScheduledNextWeek: boolean,
  isCarriedOver: boolean,
  isOverduePrior: boolean,
): boolean {
  const owed = amountOwed(c);
  const r = visitsRemaining(c);
  switch (f) {
    case "all":
      return true;
    case "payment_due":
      return owed > 0;
    case "payment_due_this_week":
      // Includes clients scheduled this week AND anyone last scheduled in the
      // immediately previous week who still hasn't paid.
      return owed > 0 && (isScheduledThisWeek || isCarriedOver);
    case "payment_due_next_week":
      return owed > 0 && isScheduledNextWeek;
    case "overdue_prior_weeks":
      return owed > 0 && isOverduePrior;
    case "not_scheduled":
      return !isScheduled;
    case "almost_finished":
      return r !== null && r > 0 && r <= 2;
    case "critical":
      return owed > 0 && r !== null && r <= 2;
    case "package_complete":
      return r !== null && c.package_total_visits > 0 && r === 0;
  }
}



function Dashboard() {
  const { isStaff } = useRole();
  const { data: clients = [], isLoading } = useClients();
  const fetchScheduledIds = useServerFn(getScheduledClientIds);
  const scheduledQuery = useQuery({
    queryKey: ["scheduled-client-ids"],
    queryFn: () => fetchScheduledIds({ data: { days: 30 } }),
    staleTime: 60_000,
  });
  const scheduledSet = useMemo(
    () => new Set<string>(scheduledQuery.data?.client_ids ?? []),
    [scheduledQuery.data],
  );
  const isScheduled = (id: string) => scheduledSet.has(id);

  const fetchThisWeekIds = useServerFn(getThisWeekScheduledClientIds);
  const thisWeekQuery = useQuery({
    queryKey: ["scheduled-this-week-client-ids"],
    queryFn: () => fetchThisWeekIds(),
    staleTime: 60_000,
  });
  const thisWeekSet = useMemo(
    () => new Set<string>(thisWeekQuery.data?.client_ids ?? []),
    [thisWeekQuery.data],
  );
  const isScheduledThisWeek = (id: string) => thisWeekSet.has(id);

  const fetchNextWeekIds = useServerFn(getNextWeekScheduledClientIds);
  const nextWeekQuery = useQuery({
    queryKey: ["scheduled-next-week-client-ids"],
    queryFn: () => fetchNextWeekIds(),
    staleTime: 60_000,
  });
  const nextWeekSet = useMemo(
    () => new Set<string>(nextWeekQuery.data?.client_ids ?? []),
    [nextWeekQuery.data],
  );
  const isScheduledNextWeek = (id: string) => nextWeekSet.has(id);

  const fetchPriorScheduled = useServerFn(getPriorWeeksScheduledClientLastDates);
  const priorScheduledQuery = useQuery({
    queryKey: ["scheduled-prior-weeks-last-dates"],
    queryFn: () => fetchPriorScheduled({ data: { weeks_back: 8 } }),
    staleTime: 60_000,
  });
  const priorScheduledMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of priorScheduledQuery.data?.clients ?? []) {
      m.set(row.client_id, row.last_scheduled_at);
    }
    return m;
  }, [priorScheduledQuery.data]);
  // Classify each prior-week booking by whether it fell in the immediately
  // previous week (carry-over to this week) or further back (overdue).
  const { carriedOverRecentMap, overduePriorMap } = useMemo(() => {
    const recent = new Map<string, string>();
    const overdue = new Map<string, string>();
    const thisWeekStart = currentWeekStartUtc();
    const prevWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    for (const [id, iso] of priorScheduledMap) {
      const bookingWeekStart = weekStartUtcOfClinic(iso);
      if (bookingWeekStart.getTime() === prevWeekStart.getTime()) {
        recent.set(id, iso);
      } else if (bookingWeekStart.getTime() < prevWeekStart.getTime()) {
        overdue.set(id, iso);
      }
    }
    return { carriedOverRecentMap: recent, overduePriorMap: overdue };
  }, [priorScheduledMap]);
  // "Carried over" = booked in the immediately previous week only, and NOT
  // scheduled this week (this-week bookings get the "Due this week" tag).
  const isCarriedOver = (id: string) =>
    carriedOverRecentMap.has(id) && !thisWeekSet.has(id);
  // "Overdue — Prior Weeks" = last booking was older than the previous week,
  // and not scheduled in this week or next week.
  const isOverduePrior = (id: string) =>
    overduePriorMap.has(id) && !thisWeekSet.has(id) && !nextWeekSet.has(id);


  const [search, setSearch] = useState("");
  // Staff never see the payment-due (aggregate) list — default to "all" instead.
  const [filter, setFilter] = useState<FilterKey>(isStaff ? "all" : "payment_due");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active_assessment");

  // Role can resolve after first render; force off payment-due filters for staff.
  useEffect(() => {
    if (
      isStaff &&
      (filter === "payment_due" ||
        filter === "payment_due_this_week" ||
        filter === "payment_due_next_week")
    ) {
      setFilter("all");
    }
  }, [isStaff, filter]);

  // Apply lifecycle status filter first — by default this hides archived clients.
  const visibleClients = useMemo(() => {
    return clients.filter((c) =>
      matchesStatus(effectiveStatus(c, isScheduled(c.id)), statusFilter),
    );
  }, [clients, statusFilter, scheduledSet]);

  const counts = useMemo(() => {
    const c = {
      all: 0,
      payment_due: 0,
      payment_due_total: 0,
      payment_due_this_week: 0,
      payment_due_this_week_total: 0,
      payment_due_next_week: 0,
      payment_due_next_week_total: 0,
      overdue_prior_weeks: 0,
      overdue_prior_weeks_total: 0,
      not_scheduled: 0,
      almost_finished: 0,
      critical: 0,
      critical_total: 0,
      package_complete: 0,
    };
    for (const cl of visibleClients) {
      const owed = amountOwed(cl);
      const r = visitsRemaining(cl);
      c.all += 1;
      if (owed > 0) {
        c.payment_due += 1;
        c.payment_due_total += owed;
        if (isScheduledThisWeek(cl.id) || isCarriedOver(cl.id)) {
          c.payment_due_this_week += 1;
          c.payment_due_this_week_total += owed;
        }
        if (isScheduledNextWeek(cl.id)) {
          c.payment_due_next_week += 1;
          c.payment_due_next_week_total += owed;
        }
        if (isOverduePrior(cl.id)) {
          c.overdue_prior_weeks += 1;
          c.overdue_prior_weeks_total += owed;
        }
      }
      if (!isScheduled(cl.id)) c.not_scheduled += 1;
      if (r !== null && r > 0 && r <= 2) c.almost_finished += 1;
      if (owed > 0 && r !== null && r <= 2) {
        c.critical += 1;
        c.critical_total += owed;
      }
      if (r !== null && cl.package_total_visits > 0 && r === 0)
        c.package_complete += 1;
    }
    return c;
  }, [visibleClients, scheduledSet, thisWeekSet, nextWeekSet, carriedOverRecentMap, overduePriorMap]);


  const filtered = useMemo(() => {
    const list = visibleClients.filter((c) =>
      matchesFilter(
        c,
        filter,
        isScheduled(c.id),
        isScheduledThisWeek(c.id),
        isScheduledNextWeek(c.id),
        isCarriedOver(c.id),
        isOverduePrior(c.id),
      ),
    );
    const q = search.trim().toLowerCase();

    const searched = q
      ? list.filter((c) =>
          `${c.first_name} ${c.last_name} ${c.phone ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : list;
    // Sort: payment-due-ish filters by balance desc; others by name
    if (
      filter === "payment_due" ||
      filter === "payment_due_this_week" ||
      filter === "payment_due_next_week" ||
      filter === "overdue_prior_weeks" ||
      filter === "critical"
    ) {
      return [...searched].sort((a, b) => amountOwed(b) - amountOwed(a));
    }
    if (filter === "almost_finished") {
      return [...searched].sort(
        (a, b) => (visitsRemaining(a) ?? 0) - (visitsRemaining(b) ?? 0),
      );
    }
    return [...searched].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [visibleClients, filter, search, scheduledSet, thisWeekSet, nextWeekSet, carriedOverRecentMap, overduePriorMap]);

  const reviewCountQuery = useQuery({
    queryKey: ["square_payments_needs_review_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("square_payments")
        .select("id", { count: "exact", head: true })
        .eq("needs_review", true);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  const reviewCount = reviewCountQuery.data ?? 0;

  const allTiles: (TileDef & { staffHidden?: boolean })[] = [
    {
      key: "payment_due",
      label: "Payment Due",
      icon: <CircleDollarSign className="h-5 w-5" />,
      count: counts.payment_due,
      money: counts.payment_due_total,
      moneyLabel: "outstanding",
      tone: "red",
      staffHidden: true,
    },
    {
      key: "payment_due_this_week",
      label: "Payment Due — This Week",
      icon: <CircleDollarSign className="h-5 w-5" />,
      count: counts.payment_due_this_week,
      money: counts.payment_due_this_week_total,
      moneyLabel: "outstanding",
      tone: "red",
      staffHidden: true,
    },
    {
      key: "payment_due_next_week",
      label: "Payment Due — Next Week",
      icon: <CircleDollarSign className="h-5 w-5" />,
      count: counts.payment_due_next_week,
      money: counts.payment_due_next_week_total,
      moneyLabel: "outstanding",
      tone: "red",
      staffHidden: true,
    },
    {
      key: "not_scheduled",
      label: "Not Scheduled",
      icon: <CalendarClock className="h-5 w-5" />,
      count: counts.not_scheduled,
      tone: "amber",
    },
    {
      key: "almost_finished",
      label: "Almost Finished",
      icon: <Hourglass className="h-5 w-5" />,
      count: counts.almost_finished,
      tone: "amber",
    },
    {
      key: "critical",
      label: "Critical",
      icon: <AlertTriangle className="h-5 w-5" />,
      count: counts.critical,
      // Hide the aggregate $ for staff, but keep the count/list — Critical is
      // the "almost finished AND owes" cohort which is useful signal.
      money: isStaff ? undefined : counts.critical_total,
      moneyLabel: "outstanding",
      tone: "red",
    },
    {
      key: "payments_review",
      label: "Payments Review",
      icon: <Receipt className="h-5 w-5" />,
      count: reviewCount,
      tone: reviewCount > 0 ? "amber" : "slate",
      href: "/sync-log",
      countLabel: "payment",
      staffHidden: true,
    },
    {
      key: "payment_history",
      label: "Payment History",
      icon: <History className="h-5 w-5" />,
      count: 0,
      tone: "slate",
      href: "/payment-history",
      hideCount: true,
      ctaLabel: "View by week",
      staffHidden: true,
    },
    {
      key: "package_complete",
      label: "Package Complete",
      icon: <CircleSlash className="h-5 w-5" />,
      count: counts.package_complete,
      tone: "slate",
    },
    {
      key: "all",
      label: "All Active",
      icon: <Users className="h-5 w-5" />,
      count: counts.all,
      tone: "slate",
    },
  ];
  const tiles = allTiles.filter((t) => !(isStaff && t.staffHidden));

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 md:mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Today</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading
              ? "Loading…"
              : `${visibleClients.length} shown · ${clients.length} total`}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-11 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:h-9 md:flex-none md:py-2"
          >
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_FILTER_LABEL[k]}
              </option>
            ))}
          </select>
          <Link to="/clients/new" className="shrink-0">
            <Button className="h-11 md:h-9">+ Add</Button>
          </Link>
        </div>
      </div>


      {/* Tiles */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-7 md:mb-8">
        {tiles.map((t) => (
          <Tile
            key={t.key}
            tile={t}
            active={!t.href && filter === t.key}
            onClick={() => { if (!t.href) setFilter(t.key as FilterKey); }}
          />
        ))}
      </div>


      {/* Filtered list */}
      <section>
        <div className="mb-3 flex items-baseline justify-between md:mb-4">
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">
            Showing: {FILTER_LABEL[filter]}
          </h2>
          <div className="flex items-center gap-3">
            {!isStaff && (filter === "payment_due" || filter === "payment_due_this_week" || filter === "payment_due_next_week") && filtered.length > 0 && (
              <button
                type="button"
                onClick={() => exportPaymentDueCsv(filtered)}
                className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                Export CSV
              </button>
            )}
            <span className="text-sm text-slate-500">{filtered.length}</span>
          </div>
        </div>

        {/* Search — sticky on mobile */}
        <div className="sticky top-0 z-20 -mx-4 mb-3 border-b bg-slate-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:mb-4 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-0">
          <Input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 text-base md:hidden"
          />
          <Card className="hidden md:block">
            <CardContent className="pt-6">
              <Input
                placeholder="Search within this view by name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 text-base"
              />
            </CardContent>
          </Card>
        </div>


        {!isStaff && (filter === "payment_due" || filter === "payment_due_this_week" || filter === "payment_due_next_week") && filtered.length > 0 && (
          <PaymentTotals clients={filtered} />
        )}

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
            {search
              ? "No matches in this view."
              : `No clients in "${FILTER_LABEL[filter]}".`}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => {
              const carriedOverIso = priorScheduledMap.get(c.id);
              let scheduleStatus: ScheduleStatus | undefined;
              let scheduleStatusDetail: string | undefined;
              if (filter === "payment_due_this_week") {
                if (isScheduledThisWeek(c.id)) {
                  scheduleStatus = "this_week";
                } else if (carriedOverIso) {
                  scheduleStatus = "carried_over";
                  scheduleStatusDetail = formatWeekRange(carriedOverIso);
                }
              } else if (filter === "payment_due") {
                scheduleStatus = isScheduledThisWeek(c.id)
                  ? "this_week"
                  : isScheduledNextWeek(c.id)
                    ? "next_week"
                    : carriedOverIso
                      ? "carried_over"
                      : "not_scheduled";
                if (scheduleStatus === "carried_over" && carriedOverIso) {
                  scheduleStatusDetail = formatWeekRange(carriedOverIso);
                }
              }
              return (
                <SmartClientCard
                  key={c.id}
                  client={c}
                  isScheduled={isScheduled(c.id)}
                  hideAmount={isStaff}
                  scheduleStatus={scheduleStatus}
                  scheduleStatusDetail={scheduleStatusDetail}
                />
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}

type TileDef = {
  key: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  money?: number;
  moneyLabel?: string;
  tone: "red" | "amber" | "slate";
  href?: string;
  countLabel?: string;
  hideCount?: boolean;
  ctaLabel?: string;
};

function Tile({
  tile,
  active,
  onClick,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
}) {
  const activeRing =
    tile.tone === "red"
      ? "ring-red-500 border-red-300 bg-red-50"
      : tile.tone === "amber"
        ? "ring-amber-500 border-amber-300 bg-amber-50"
        : "ring-slate-900 border-slate-300 bg-slate-50";
  const iconTone =
    tile.tone === "red"
      ? "text-red-600 bg-red-100"
      : tile.tone === "amber"
        ? "text-amber-600 bg-amber-100"
        : "text-slate-700 bg-slate-100";
  const inner = (
    <>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone}`}>
        {tile.icon}
      </div>
      <div className="text-sm font-medium text-slate-600">{tile.label}</div>
      {tile.hideCount ? (
        <div className="text-base font-medium text-slate-700">
          {tile.ctaLabel ?? "View"}
        </div>
      ) : (
        <div className="text-2xl font-semibold tracking-tight text-slate-900">
          {tile.count}
          <span className="ml-1 text-sm font-normal text-slate-500">
            {tile.count === 1 ? tile.countLabel ?? "client" : `${tile.countLabel ?? "client"}s`}
          </span>
        </div>
      )}
      {tile.money !== undefined && tile.money > 0 && (
        <div className="text-xs font-medium text-slate-600">
          {formatCurrency(tile.money)} {tile.moneyLabel}
        </div>
      )}
    </>
  );

  const baseClass = `flex flex-col items-start gap-2 rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow ${
    active ? `ring-2 ${activeRing}` : ""
  }`;

  if (tile.href) {
    return (
      <Link to={tile.href} className={baseClass}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={baseClass}>
      {inner}
    </button>
  );
}

function PaymentTotals({ clients }: { clients: Client[] }) {
  const owed = clients.map((c) => amountOwed(c));
  const total = owed.reduce((a, b) => a + b, 0);
  const highest = owed.length ? Math.max(...owed) : 0;
  const average = owed.length ? total / owed.length : 0;

  const stats: { label: string; value: string }[] = [
    { label: "Total Outstanding", value: formatCurrency(total) },
    { label: "Clients Owing", value: String(clients.length) },
    { label: "Highest Balance", value: formatCurrency(highest) },
    { label: "Average Balance", value: formatCurrency(average) },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {s.label}
          </div>
          <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function exportPaymentDueCsv(clients: Client[]) {
  const rows = [
    ["Name", "Amount Owed"],
    ...clients.map((c) => [
      fullName(c),
      String(amountOwed(c)),
    ]),
  ];
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "payment-due-export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CLINIC_TZ = "America/Chicago";

// Sunday start (UTC-anchored representation) of the clinic-local week that
// contains the given ISO instant.
function weekStartUtcOfClinic(iso: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const [y, m, day] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, day - dow));
}

function currentWeekStartUtc(): Date {
  return weekStartUtcOfClinic(new Date().toISOString());
}

// Format the clinic-local Sun–Sat week range that contains the given ISO
// instant, e.g. "Nov 30 – Dec 6". Used by the "Carried over from …" tag.
function formatWeekRange(iso: string): string {
  const startUtc = weekStartUtcOfClinic(iso);
  const endUtc = new Date(startUtc.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${fmt.format(startUtc)} – ${fmt.format(endUtc)}`;
}




// Keep StatusBadge import used elsewhere referenced to avoid unused-import noise
void StatusBadge;
