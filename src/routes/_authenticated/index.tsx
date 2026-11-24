import { useSimplePackageClientIds } from "@/hooks/useSimplePackageClientIds";
import { DashboardTodaySchedule } from "@/components/DashboardTodaySchedule";
import { DashboardDuesTile } from "@/components/DashboardDuesTile";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "@/hooks/usePersistentState";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarX,

  ClipboardList,

  CalendarClock,
  CircleDollarSign,
  CircleSlash,
  History,
  Hourglass,
  Receipt,
  Users,
  UserPlus,
  RefreshCw,
  HelpCircle,
  MessageSquare,
} from "lucide-react";

import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SmartClientCard } from "@/components/SmartClientCard";
import { ArchiveClientButton } from "@/components/ArchiveClientButton";
import { PreRenewCard } from "@/components/PreRenewCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  amountOwed,
  previousOwed,
  totalOwed,
  effectiveStatus,
  formatDate,
  formatCurrency,
  fullName,
  needsPackageReview,
  visitsRemaining,
  type Client,
  type LifecycleStatus,
} from "@/lib/clients";
import { usePackageReviewDismissedIds } from "@/components/PackageReviewBadge";

import {
  getScheduledClientIds,
  getThisWeekScheduledClientIds,
  getNextWeekScheduledClientIds,
  getPriorWeeksScheduledClientLastDates,
  getRenewalForecast,
  getMissedCheckInSummary,

  type RenewalForecastRow,
} from "@/lib/schedule.functions";
import type { ScheduleStatus } from "@/components/SmartClientCard";
import { useRole } from "@/hooks/useRole";
import {
  groupWeeklyPayments,
  type WeeklyPaymentGroups,
  type WeeklyPaymentRow,
} from "@/lib/weekly-payment-groups";
import { invalidateFor } from "@/lib/invalidation";
import { applyOverridesToRows, type PackageOverride } from "@/lib/package-override";


export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · FIT Beyond Therapy Hub" }, { name: "description", content: "FIT Beyond Therapy staff scheduling and client operations." }, { property: "og:title", content: "Dashboard · FIT Beyond Therapy Hub" }, { property: "og:description", content: "FIT Beyond Therapy staff scheduling and client operations." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Dashboard,
});

function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      // Without a session RLS returns an empty list instead of an error,
      // which would silently zero the tiles. Fail so it retries instead.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) throw new Error("Session not ready");
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
      // Apply audited package corrections so queues match the profile.
      const overrides = await supabase.from("package_overrides").select("*").is("cleared_at", null);
      if (overrides.error) throw overrides.error;
      return applyOverridesToRows(all, (overrides.data ?? []) as (PackageOverride & { client_id: string })[]);
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
  | "package_complete"
  | "needs_renewal"
  | "renewal_scheduled"
  | "needs_package_review";

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
  needs_renewal: "Needs Renewal",
  renewal_scheduled: "Renewal Scheduled",
  needs_package_review: "First Visit — No Package Info, Needs Review",
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

/**
 * When a client's package starts in the FUTURE (typical right after a
 * renewal), the new balance is due when that package starts — not because a
 * now-finished appointment still sits in the current week. This bucket
 * overrides the booking-derived weekly bucketing for those clients.
 */
type StartBucket = "this" | "next" | "later" | null;

function matchesFilter(
  c: Client,
  f: FilterKey,
  isScheduled: boolean,
  isScheduledThisWeek: boolean,
  isScheduledNextWeek: boolean,
  isCarriedOver: boolean,
  isOverduePrior: boolean,
  startBucket: StartBucket = null,
  needsPkgReview: boolean = false,
  needsRenewal: boolean = false,
  renewalScheduled: boolean = false,
): boolean {

  const currentOwed = amountOwed(c);
  const prevOwed = previousOwed(c);
  const owed = currentOwed + prevOwed;
  const r = visitsRemaining(c);
  switch (f) {
    case "all":
      return true;
    case "payment_due":
      return owed > 0;
    case "payment_due_this_week":
      // Owes money AND has a booking this week (or a future package start
      // that lands in this week).
      return currentOwed > 0 && (startBucket ? startBucket === "this" : isScheduledThisWeek);
    case "payment_due_next_week":
      return currentOwed > 0 && (startBucket ? startBucket === "next" : isScheduledNextWeek);
    case "overdue_prior_weeks":
      // Owes money AND does NOT have a booking this week — mutually
      // exclusive with Payment Due — This Week, and together they cover
      // every client with an outstanding balance. A package that hasn't
      // started yet is never overdue.
      // Debt carried over from a finished package is always overdue.
      return prevOwed > 0 || (currentOwed > 0 && !startBucket && !isScheduledThisWeek);
    case "not_scheduled":
      return !isScheduled;
    case "almost_finished":
      return r !== null && r > 0 && r <= 2;
    case "critical":
      return owed > 0 && r !== null && r <= 2;
    case "package_complete":
      return r !== null && c.package_total_visits > 0 && r === 0;
    case "needs_renewal":
      // Driven by the upcoming-appointment forecast: the client has booked
      // more upcoming visits than their current package can still cover, so
      // one of those appointments starts a new package. Once staff prepares
      // the next package the client moves to "Renewal Scheduled".
      return needsRenewal && !renewalScheduled;
    case "renewal_scheduled":
      // Already handled: a prepared/pending next package exists.
      return renewalScheduled;
    case "needs_package_review":
      return needsPkgReview;
  }

}

const CLINIC_TZ = "America/Chicago";

/** Clinic-local YYYY-MM-DD for an instant. */
function clinicYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// New-clients-per-month counter starts at August 2026. The ~1,700 June-2026
// records are a bulk import, not genuine new additions, so they are excluded.
const NEW_CLIENTS_START_MONTH = "2026-08";

/** Clinic-local "YYYY-MM" for an ISO instant. */
function clinicMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(iso));
}

/** "YYYY-MM" of the current clinic-local month. */
function currentClinicMonth(): string {
  return clinicMonth(new Date().toISOString());
}

/** Build the list of months (YYYY-MM) from the start month through today. */
function buildMonthRange(startMonth: string): string[] {
  const [sy, sm] = startMonth.split("-").map(Number);
  const end = currentClinicMonth();
  const [ey, em] = end.split("-").map(Number);
  const months: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** Short month name for a "YYYY-MM" key, e.g. "2026-09" -> "Sep". */
function shortMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Long month + year for a "YYYY-MM" key, e.g. "2026-09" -> "September 2026". */
function longMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

interface NewClientsMonth {
  month: string;
  clients: Client[];
}

/**
 * Group non-soft-deleted clients created on/after NEW_CLIENTS_START_MONTH by
 * their clinic-local created_at month, sorted newest month first and within
 * each month by created_at descending (newest additions first).
 */
function groupNewClientsByMonth(clients: Client[]): NewClientsMonth[] {
  const buckets = new Map<string, Client[]>();
  for (const c of clients) {
    if (c.deleted_at) continue;
    const month = clinicMonth(c.created_at);
    if (month < NEW_CLIENTS_START_MONTH) continue;
    const arr = buckets.get(month) ?? [];
    arr.push(c);
    buckets.set(month, arr);
  }
  const months = buildMonthRange(NEW_CLIENTS_START_MONTH);
  return months
    .slice()
    .reverse()
    .map((month) => ({
      month,
      clients: (buckets.get(month) ?? [])
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }));
}


function Dashboard() {
  const { isStaff } = useRole();
  const { data: clients = [], isLoading } = useClients();
  const fetchScheduledIds = useServerFn(getScheduledClientIds);
  const scheduledQuery = useQuery({
    queryKey: ["scheduled-client-ids"],
    queryFn: () => orThrow(fetchScheduledIds({ data: { days: 30 } })),
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
    queryFn: () => orThrow(fetchThisWeekIds()),
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
    queryFn: () => orThrow(fetchNextWeekIds()),
    staleTime: 60_000,
  });
  const nextWeekSet = useMemo(
    () => new Set<string>(nextWeekQuery.data?.client_ids ?? []),
    [nextWeekQuery.data],
  );
  const isScheduledNextWeek = (id: string) => nextWeekSet.has(id);

  // Needs Renewal forecast: clients who have booked more upcoming visits than
  // their current package can still cover.
  const fetchRenewalForecast = useServerFn(getRenewalForecast);
  const renewalQuery = useQuery({
    queryKey: ["renewal-forecast"],
    queryFn: () => orThrow(fetchRenewalForecast()),
    staleTime: 60_000,
  });
  const renewalMap = useMemo(() => {
    const m = new Map<string, RenewalForecastRow>();
    for (const row of renewalQuery.data?.rows ?? []) m.set(row.client_id, row);
    return m;
  }, [renewalQuery.data]);


  const fetchPriorScheduled = useServerFn(getPriorWeeksScheduledClientLastDates);
  const priorScheduledQuery = useQuery({
    queryKey: ["scheduled-prior-weeks-last-dates"],
    queryFn: () => orThrow(fetchPriorScheduled({ data: { weeks_back: 8 } })),
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

  // A package whose start date is still in the future (typical right after a
  // renewal) is due when it starts, not because of leftover bookings from the
  // week the renewal was entered.
  const thisWeekEndYmd = thisWeekQuery.data?.week_end;
  const nextWeekEndYmd = nextWeekQuery.data?.week_end;
  const startBucketOf = (c: Client): StartBucket => {
    const start = c.package_start_date;
    if (!start || !thisWeekEndYmd || !nextWeekEndYmd) return null;
    if (start <= clinicYmd(new Date())) return null; // already started
    if (start <= thisWeekEndYmd) return "this";
    if (start <= nextWeekEndYmd) return "next";
    return "later";
  };

  const dismissedIds = usePackageReviewDismissedIds().data ?? null;
  const packageClientIds = useSimplePackageClientIds().data ?? null;

  // Auto-create package shells from Square visit notes for clients with no
  // package info (price left blank, flagged for review). Runs once per
  // dashboard visit for staff; idempotent on the server.
  const queryClient = useQueryClient();
  const [search, setSearch] = usePersistentState("dash:search", "");
  // A new presentation key prevents retired per-user filters from resurfacing.
  const [filter, setFilter] = usePersistentState<FilterKey>("dash:simple-filter", "not_scheduled");
  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>("dash:status", "active_assessment");

  // New-clients-per-month view state. Activated by the "New Clients" tile.
  const [newClientsActive, setNewClientsActive] = usePersistentState("dash:newClients", false);
  const [newClientsMonth, setNewClientsMonth] = usePersistentState<string>("dash:newClientsMonth", currentClinicMonth());

  // Role can resolve after first render; force off payment-due filters for staff.
  useEffect(() => {
    if (
      isStaff &&
      (filter === "payment_due" ||
        filter === "payment_due_this_week" ||
        filter === "payment_due_next_week" ||
        filter === "overdue_prior_weeks")
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

  // New-clients-per-month grouping. Includes archived clients (they were
  // genuinely added that month); excludes soft-deleted records. Derived from
  // the full `clients` list, independent of the status filter.
  const newClientsByMonth = useMemo(
    () => groupNewClientsByMonth(clients),
    [clients],
  );
  const newClientsMonthMap = useMemo(() => {
    const m = new Map<string, NewClientsMonth>();
    for (const mc of newClientsByMonth) m.set(mc.month, mc);
    return m;
  }, [newClientsByMonth]);
  const currentMonthNewCount =
    newClientsMonthMap.get(currentClinicMonth())?.clients.length ?? 0;
  const selectedNewClients =
    newClientsMonthMap.get(newClientsMonth)?.clients ?? [];

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
      needs_renewal: 0,
      renewal_scheduled: 0,
      needs_package_review: 0,
      // Money owed for the NEXT package, tracked separately from the
      // current-package balance above.
      next_package_this_week_total: 0,
      next_package_next_week_total: 0,
      // Split of all forecasted next-package money by whether staff has
      // already prepared the renewal. Keeps the two renewal tiles from
      // reporting the same dollars twice.
      next_package_prepared_total: 0,
      next_package_unprepared_total: 0,
    };

    for (const cl of visibleClients) {
      const currentOwed = amountOwed(cl);
      const prevOwed = previousOwed(cl);
      const owed = currentOwed + prevOwed;
      const r = visitsRemaining(cl);
      c.all += 1;
      if (owed > 0) {
        const bucket = startBucketOf(cl);
        c.payment_due += 1;
        c.payment_due_total += owed;
        const currentIsThisWeek = bucket ? bucket === "this" : isScheduledThisWeek(cl.id);
        if (currentOwed > 0 && currentIsThisWeek) {
          c.payment_due_this_week += 1;
          c.payment_due_this_week_total += currentOwed;
        }
        // Old-package debt is always overdue; current debt is overdue only
        // when there's no booking this week, none next week, and no future
        // package start. Mirrors the row helper so each dollar lands once.
        const currentIsNextWeek = bucket ? bucket === "next" : isScheduledNextWeek(cl.id);
        const currentIsOverdue =
          currentOwed > 0 && !bucket && !currentIsThisWeek && !currentIsNextWeek;
        if (prevOwed > 0 || currentIsOverdue) {
          c.overdue_prior_weeks += 1;
          c.overdue_prior_weeks_total += prevOwed + (currentIsOverdue ? currentOwed : 0);
        }

        if (currentOwed > 0 && (bucket ? bucket === "next" : isScheduledNextWeek(cl.id))) {
          c.payment_due_next_week += 1;
          c.payment_due_next_week_total += currentOwed;
        }
      }

      const forecast = renewalMap.get(cl.id);
      if (forecast) {
        // Prepared renewals are "handled" and leave the action queue, but
        // their next-package money still counts in the weekly totals.
        if (forecast.pre_renewed) {
          c.renewal_scheduled += 1;
          c.next_package_prepared_total += forecast.next_package_price;
        } else {
          c.needs_renewal += 1;
          c.next_package_unprepared_total += forecast.next_package_price;
        }
        if (forecast.week_bucket === "this") {
          c.next_package_this_week_total += forecast.next_package_price;
        } else if (forecast.week_bucket === "next") {
          c.next_package_next_week_total += forecast.next_package_price;
        }
      }


      if (!isScheduled(cl.id)) c.not_scheduled += 1;
      if (r !== null && r > 0 && r <= 2) c.almost_finished += 1;
      if (owed > 0 && r !== null && r <= 2) {
        c.critical += 1;
        c.critical_total += owed;
      }
      if (r !== null && cl.package_total_visits > 0 && r === 0) {
        c.package_complete += 1;
      }
      if (needsPackageReview(cl, dismissedIds, cl.id, packageClientIds)) c.needs_package_review += 1;
    }
    return c;
  }, [visibleClients, scheduledSet, thisWeekSet, nextWeekSet, carriedOverRecentMap, overduePriorMap, thisWeekEndYmd, nextWeekEndYmd, dismissedIds, packageClientIds, renewalMap]);

  const weeklyPaymentGroups = useMemo(() => {
    if (filter !== "payment_due_this_week" && filter !== "payment_due_next_week") return null;
    const bucket = filter === "payment_due_this_week" ? "this" : "next";
    return groupWeeklyPayments(visibleClients, renewalMap, bucket, (client) => {
      const owed = amountOwed(client);
      const startBucket = startBucketOf(client);
      const scheduledForWeek = bucket === "this"
        ? isScheduledThisWeek(client.id)
        : isScheduledNextWeek(client.id);
      return owed > 0 && (startBucket ? startBucket === bucket : scheduledForWeek);
    });
  }, [filter, visibleClients, renewalMap, thisWeekSet, nextWeekSet, thisWeekEndYmd, nextWeekEndYmd]);


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
        startBucketOf(c),
        needsPackageReview(c, dismissedIds, c.id, packageClientIds),
        renewalMap.has(c.id),
        renewalMap.get(c.id)?.pre_renewed === true,
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
      return [...searched].sort((a, b) => totalOwed(b) - totalOwed(a));
    }
    if (filter === "almost_finished") {
      return [...searched].sort(
        (a, b) => (visitsRemaining(a) ?? 0) - (visitsRemaining(b) ?? 0),
      );
    }
    if (filter === "needs_renewal" || filter === "renewal_scheduled") {
      // Soonest new-package start first.
      return [...searched].sort((a, b) =>
        (renewalMap.get(a.id)?.first_uncovered_ymd ?? "").localeCompare(
          renewalMap.get(b.id)?.first_uncovered_ymd ?? "",
        ),
      );
    }
    return [...searched].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [visibleClients, filter, search, scheduledSet, thisWeekSet, nextWeekSet, carriedOverRecentMap, overduePriorMap, thisWeekEndYmd, nextWeekEndYmd, renewalMap, dismissedIds, packageClientIds]);

  return (
    <AppShell>
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 md:mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dash</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading
              ? "Loading…"
              : `${visibleClients.length} shown · ${clients.length} total`}
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-11"><Link to="/clients">Clients</Link></Button>
      </div>


      <div aria-label="Dashboard tiles" className="grid gap-3 sm:grid-cols-3">
        <DashboardDuesTile />
        <Button variant="outline" className="h-auto min-h-36 flex-col items-start justify-start gap-3 whitespace-normal rounded-md p-5 text-left" aria-pressed={!newClientsActive} onClick={() => { setFilter("not_scheduled"); setNewClientsActive(false); }}>
          <span className="flex items-center gap-2 text-base font-semibold"><CalendarClock className="size-5" />Not Scheduled</span>
          <span className="text-3xl font-semibold tabular-nums">{isLoading ? "—" : counts.not_scheduled}</span>
          <span className="text-sm text-muted-foreground">clients</span>
        </Button>
        <Button variant="outline" className="h-auto min-h-36 flex-col items-start justify-start gap-3 whitespace-normal rounded-md p-5 text-left" aria-pressed={newClientsActive} onClick={() => { setNewClientsMonth(currentClinicMonth()); setNewClientsActive(true); }}>
          <span className="flex items-center gap-2 text-base font-semibold"><UserPlus className="size-5" />New Clients</span>
          <span className="text-3xl font-semibold tabular-nums">{isLoading ? "—" : currentMonthNewCount}</span>
          <span className="text-sm text-muted-foreground">{longMonthLabel(currentClinicMonth())}</span>
        </Button>
      </div>
      <div className="my-6"><DashboardTodaySchedule /></div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4"><Button asChild variant="outline" className="min-h-11 whitespace-normal"><Link to="/schedule-check" search={{view:"worklists"}}>Scheduling Worklists</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to="/follow-ups" search={{task:undefined}}>Follow-ups</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to="/clients/new">Add Client</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to="/more">More</Link></Button></div>
      {/* New Clients per month — admin tile view */}
      {newClientsActive && (
        <NewClientsByMonthView
          months={newClientsByMonth}
          selectedMonth={newClientsMonth}
          onSelectMonth={setNewClientsMonth}
          selectedClients={selectedNewClients}
          isScheduled={isScheduled}
          hideAmount={isStaff}
          onClose={() => setNewClientsActive(false)}
        />
      )}

      {/* Filtered list */}
      {!newClientsActive && (
      <section>
        <div className="mb-3 flex items-baseline justify-between md:mb-4">
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">
            Showing: {FILTER_LABEL[filter]}
          </h2>
          <div className="flex items-center gap-3">
            {!isStaff && (filter === "payment_due" || filter === "payment_due_this_week" || filter === "payment_due_next_week" || filter === "overdue_prior_weeks") && filtered.length > 0 && (
              <button
                type="button"
                onClick={() => weeklyPaymentGroups
                  ? exportWeeklyPaymentCsv(weeklyPaymentGroups)
                  : exportPaymentDueCsv(filtered)}
                className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                Export CSV
              </button>
            )}
            <span className="text-sm text-slate-500">
              {weeklyPaymentGroups
                ? new Set([
                    ...weeklyPaymentGroups.current,
                    ...weeklyPaymentGroups.renewalScheduled,
                    ...weeklyPaymentGroups.needsRenewal,
                  ].map((row) => row.client.id)).size
                : filtered.length}
            </span>
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


        {!isStaff && !weeklyPaymentGroups && (filter === "payment_due" || filter === "overdue_prior_weeks") && filtered.length > 0 && (
          <PaymentTotals clients={filtered} />
        )}

        {!isStaff && weeklyPaymentGroups ? (
          <WeeklyPaymentView
            groups={weeklyPaymentGroups}
            weekLabel={filter === "payment_due_this_week" ? "This Week" : "Next Week"}
            search={search}
            isScheduled={isScheduled}
          />
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
            {search
              ? "No matches in this view."
              : `No clients in "${FILTER_LABEL[filter]}".`}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => {
              const recentCarryIso = carriedOverRecentMap.get(c.id);
              const overdueIso = overduePriorMap.get(c.id);
              // Most recent prior booking of any age — used for the
              // "Owes from week of …" tag on the Overdue tile.
              const lastPriorIso = recentCarryIso ?? overdueIso;
              let scheduleStatus: ScheduleStatus | undefined;
              let scheduleStatusDetail: string | undefined;
              if (filter === "payment_due_this_week") {
                scheduleStatus = "this_week";
              } else if (filter === "overdue_prior_weeks") {
                scheduleStatus = "overdue_prior";
                if (lastPriorIso) {
                  scheduleStatusDetail = formatWeekRange(lastPriorIso);
                }
              } else if (filter === "payment_due") {
                if (isScheduledThisWeek(c.id)) {
                  scheduleStatus = "this_week";
                } else if (isScheduledNextWeek(c.id)) {
                  scheduleStatus = "next_week";
                } else if (lastPriorIso) {
                  scheduleStatus = "overdue_prior";
                  scheduleStatusDetail = formatWeekRange(lastPriorIso);
                } else {
                  scheduleStatus = "not_scheduled";
                }
              }
              const forecast =
                filter === "needs_renewal" || filter === "renewal_scheduled"
                  ? renewalMap.get(c.id)
                  : undefined;
              return (
                <div key={c.id} className="flex flex-col gap-2">
                  <SmartClientCard
                    client={c}
                    isScheduled={isScheduled(c.id)}
                    hideAmount={isStaff}
                    dismissedFromPackageReview={dismissedIds?.has(c.id) ?? false}
                    scheduleStatus={scheduleStatus}
                    scheduleStatusDetail={scheduleStatusDetail}
                  />
                  {forecast && <PreRenewCard forecast={forecast} hideAmount={isStaff} />}
                  {(filter === "payment_due" || filter === "payment_due_this_week" || filter === "payment_due_next_week" || filter === "overdue_prior_weeks") && (
                    <ArchiveClientButton clientId={c.id} clientName={fullName(c)} archived={c.status === "archived"} size="sm" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}
    </AppShell>
  );
}

function NewClientsByMonthView({
  months,
  selectedMonth,
  onSelectMonth,
  selectedClients,
  isScheduled,
  hideAmount,
  onClose,
}: {
  months: NewClientsMonth[];
  selectedMonth: string;
  onSelectMonth: (m: string) => void;
  selectedClients: Client[];
  isScheduled: (id: string) => boolean;
  hideAmount: boolean;
  onClose: () => void;
}) {
  const dismissedIds = usePackageReviewDismissedIds().data ?? null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between md:mb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">
            New Clients by Month
          </h2>
        </div>
        <span className="text-sm text-slate-500">
          {selectedClients.length} in {longMonthLabel(selectedMonth)}
        </span>
      </div>

      {/* Month picker */}
      <div className="mb-4 flex flex-wrap gap-2">
        {months.map((mc) => {
          const active = mc.month === selectedMonth;
          return (
            <button
              key={mc.month}
              type="button"
              onClick={() => onSelectMonth(mc.month)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors " +
                (active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
              }
            >
              <CalendarDays className="h-4 w-4" />
              {shortMonthLabel(mc.month)}
              <span
                className={
                  "ml-1 rounded-full px-1.5 py-0.5 text-xs " +
                  (active
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600")
                }
              >
                {mc.clients.length}
              </span>
            </button>
          );
        })}
      </div>

      {selectedClients.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
          No new clients in {longMonthLabel(selectedMonth)}.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {selectedClients.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
              <SmartClientCard
                client={c}
                isScheduled={isScheduled(c.id)}
                hideAmount={hideAmount}
                dismissedFromPackageReview={dismissedIds?.has(c.id) ?? false}
              />
              <div className="-mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Added {formatDate(c.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PaymentTotals({ clients }: { clients: Client[] }) {
  const owed = clients.map((c) => totalOwed(c));
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

function WeeklyPaymentView({
  groups,
  weekLabel,
  search,
  isScheduled,
}: {
  groups: WeeklyPaymentGroups;
  weekLabel: string;
  search: string;
  isScheduled: (id: string) => boolean;
}) {
  const dismissedIds = usePackageReviewDismissedIds().data ?? null;
  const q = search.trim().toLowerCase();
  const matches = (row: WeeklyPaymentRow) =>
    !q || `${row.client.first_name} ${row.client.last_name} ${row.client.phone ?? ""}`.toLowerCase().includes(q);
  const sections = [
    {
      key: "current",
      title: `Current Package Due ${weekLabel}`,
      amount: groups.totals.current,
      rows: groups.current.filter(matches),
      badge: "Payment Due",
      badgeClass: "border-red-200 bg-red-100 text-red-800",
    },
    {
      key: "scheduled",
      title: `Renewal Scheduled — ${weekLabel}`,
      amount: groups.totals.renewalScheduled,
      rows: groups.renewalScheduled.filter(matches),
      badge: "Renewal Scheduled",
      badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-800",
    },
    {
      key: "needs",
      title: `Needs Renewal — ${weekLabel}`,
      amount: groups.totals.needsRenewal,
      rows: groups.needsRenewal.filter(matches),
      badge: "Needs Renewal",
      badgeClass: "border-amber-200 bg-amber-100 text-amber-800",
    },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 lg:grid-cols-4">
        {[
          ["Current package due", groups.totals.current],
          ["Renewal scheduled", groups.totals.renewalScheduled],
          ["Needs renewal", groups.totals.needsRenewal],
          ["Combined total", groups.totals.combined],
        ].map(([label, amount]) => (
          <div key={String(label)}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(Number(amount))}
            </div>
          </div>
        ))}
      </div>

      {sections.map((section) => (
        <section key={section.key}>
          <div className="mb-3 flex items-end justify-between gap-3 border-b pb-2">
            <div>
              <h3 className="font-semibold text-slate-900">{section.title}</h3>
              <p className="text-sm text-slate-500">{section.rows.length} clients</p>
            </div>
            <div className="text-lg font-semibold text-slate-900">{formatCurrency(section.amount)}</div>
          </div>
          {section.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-slate-500">
              {q ? "No matches in this section." : "No clients in this section."}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.rows.map((row) => {
                const hasBoth = row.currentAmount > 0 && row.nextAmount > 0;
                const amounts = row.nextAmount > 0
                  ? [
                      { label: "Next package amount", amount: row.nextAmount, className: "text-amber-700" },
                      ...(hasBoth ? [{ label: "Total owed", amount: row.currentAmount + row.nextAmount }] : []),
                    ]
                  : [];
                return (
                  <div key={`${section.key}-${row.client.id}`} className="flex flex-col gap-2">
                    <SmartClientCard
                      client={row.client}
                      isScheduled={isScheduled(row.client.id)}
                      dismissedFromPackageReview={dismissedIds?.has(row.client.id) ?? false}
                      badges={section.key === "current"
                        ? []
                        : [{ label: section.badge, className: section.badgeClass }]}
                      balanceLabel={row.nextAmount > 0 ? "Current package owed" : "Current balance"}
                      balanceAmount={row.currentAmount}
                      additionalAmounts={amounts}
                    />
                    {row.forecast && row.nextAmount > 0 && (
                      <PreRenewCard forecast={row.forecast as RenewalForecastRow} />
                    )}
                    <ArchiveClientButton
                      clientId={row.client.id}
                      clientName={fullName(row.client)}
                      archived={row.client.status === "archived"}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function exportPaymentDueCsv(clients: Client[]) {
  const rows = [
    ["Name", "Amount Owed"],
    ...clients.map((c) => [
      fullName(c),
      String(totalOwed(c)),
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

function exportWeeklyPaymentCsv(groups: WeeklyPaymentGroups) {
  const byClient = new Map<string, WeeklyPaymentRow>();
  for (const row of [...groups.current, ...groups.renewalScheduled, ...groups.needsRenewal]) {
    const prior = byClient.get(row.client.id);
    byClient.set(row.client.id, {
      ...row,
      currentAmount: Math.max(prior?.currentAmount ?? 0, row.currentAmount),
      nextAmount: Math.max(prior?.nextAmount ?? 0, row.nextAmount),
    });
  }
  const rows = [
    ["Name", "Current Package Owed", "Next Package Owed", "Renewal State", "Expected Renewal (Square)", "Total Owed"],
    ...[...byClient.values()].map((row) => [
      fullName(row.client),
      String(row.currentAmount),
      String(row.nextAmount),
      row.forecast ? (row.forecast.pre_renewed ? "Renewal Scheduled" : "Needs Renewal") : "Payment Due",
      row.forecast ? (row.forecast.no_upcoming ? "Prepared — No Scheduled Start" : row.forecast.first_uncovered_ymd) : "",
      String(row.currentAmount + row.nextAmount),
    ]),
  ];
  downloadCsv(rows, "weekly-payment-due-export.csv");
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


// Monday of the WORK-WEEK (Mon–Fri) the given ISO instant belongs to, in
// clinic-local time. Sat/Sun roll forward into the upcoming work week to
// match the server-side `workWeekStartFromYmd` in schedule.functions.ts.
function weekStartUtcOfClinic(iso: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const [y, m, day] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? 1 : dow === 6 ? 2 : -(dow - 1);
  return new Date(Date.UTC(y, m - 1, day + offset));
}

function currentWeekStartUtc(): Date {
  return weekStartUtcOfClinic(new Date().toISOString());
}

// Format the clinic-local Mon–Fri work-week range that contains the given
// ISO instant, e.g. "Dec 1 – Dec 5". Used by the "Carried over from …" tag
// and by dashboard tile date sublabels.
function formatWeekRange(iso: string): string {
  const startUtc = weekStartUtcOfClinic(iso);
  const endUtc = new Date(startUtc.getTime() + 4 * 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt.format(startUtc)} – ${fmt.format(endUtc)}`;
}

// Format a "YYYY-MM-DD" .. "YYYY-MM-DD" pair as "Mon D – Mon D".
function formatYmdRange(startYmd?: string, endYmd?: string): string | undefined {
  if (!startYmd || !endYmd) return undefined;
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  return `${fmt.format(parse(startYmd))} – ${fmt.format(parse(endYmd))}`;
}




// Keep StatusBadge import used elsewhere referenced to avoid unused-import noise
void StatusBadge;

/** Format a "YYYY-MM-DD" as "Mon D, YYYY". */
function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Server lookups report Square problems (e.g. rate limits) as `error` in the
// result. Throw so React Query retries and keeps the last good numbers on the
// tile instead of caching an empty result for minutes.
async function orThrow<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  const err = (r as { error?: string | null } | null)?.error;
  if (err) throw new Error(err);
  return r;
}
