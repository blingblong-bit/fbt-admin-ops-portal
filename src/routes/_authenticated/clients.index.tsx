import { usePersistentState } from "@/hooks/usePersistentState";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  totalOwed,
  packagePriceUnknown,
  effectiveStatus,
  formatCurrency,
  fullName,
  progress,
  needsPackageReview,
  type Client,
  type LifecycleStatus,
} from "@/lib/clients";
import { getScheduleCheck, getRenewalForecast, getScheduledClientIds, type ScheduleAppointment } from "@/lib/schedule.functions";
import { chicagoYmd } from "@/lib/work-week";
import { hubHead } from "@/lib/hub-navigation";
import { applyOverridesToRows, type PackageOverride } from "@/lib/package-override";
import { getPackageSetupList } from "@/lib/package-setup.functions";
import { useRole } from "@/hooks/useRole";
import { usePackageReviewDismissedIds } from "@/components/PackageReviewBadge";


export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => hubHead("Clients", "Search clients and existing package, renewal and scheduling queues."),
  component: ClientsListPage,
});

type StatusFilter = "active_assessment" | "active" | "assessment" | "archived" | "deleted" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  active_assessment: "All Active",
  active: "Active only",
  assessment: "Assessment only",
  archived: "Archived",
  deleted: "Deleted",
  all: "All (incl. archived)",
};

function matchesStatusFilter(eff: LifecycleStatus, f: StatusFilter): boolean {
  switch (f) {
    case "active_assessment":
      return eff === "active" || eff === "assessment";
    case "active":
      return eff === "active";
    case "assessment":
      return eff === "assessment";
    case "archived":
      return eff === "archived";
    case "deleted":
      return false; // handled by data fetch
    case "all":
      return true;
  }
}

function ClientsListPage() {
  const { isStaff } = useRole();
  const dismissedIds = usePackageReviewDismissedIds().data ?? null;
  const [search, setSearch] = usePersistentState("clients:search", "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active_assessment");
  const [view, setView] = useState("all");
  const scheduleFn = useServerFn(getScheduleCheck);
  const renewalFn = useServerFn(getRenewalForecast);
  const setupFn = useServerFn(getPackageSetupList);
  const today = chicagoYmd();
  const schedule = useQuery({ queryKey: ["schedule-check", today], queryFn: () => scheduleFn({ data: { date: today } }), enabled: ["today", "week", "not_next", "not_scheduled"].includes(view), staleTime: 60_000 });
  const renewals = useQuery({ queryKey: ["renewal-forecast"], queryFn: () => renewalFn(), enabled: view === "renewals", staleTime: 60_000 });
  const setup = useQuery({ queryKey: ["renewal-forecast", "package-setup"], queryFn: () => setupFn(), enabled: view === "package", staleTime: 60_000 });
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

  const { data: clients = [], isLoading, error: clientError, refetch: retryClients } = useQuery({
    queryKey: ["clients", "all-with-deleted"],
    queryFn: async () => {
      // Paginate in 1000-row chunks to bypass PostgREST's default cap
      const all: Client[] = [];
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data, error } = await supabase
          .from("clients")
          .select("*")
          .order("last_name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as Client[];
        if (page.length === 0) break;
        all.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      const overrides = await supabase.from("package_overrides").select("*").is("cleared_at", null);
      if (overrides.error) throw overrides.error;
      return applyOverridesToRows(all, (overrides.data ?? []) as (PackageOverride & { client_id: string })[]);
    },
  });

  const viewIds = useMemo(() => {
    if (view === "renewals") return new Set(renewals.data?.rows.map(r => r.client_id) ?? []);
    if (view === "package") return new Set([...clients.filter(c => needsPackageReview(c, dismissedIds, c.id)).map(c => c.id), ...(setup.data?.rows.map(r => r.client_id) ?? [])]);
    const d = schedule.data;
    const ids = (list: ScheduleAppointment[]) => new Set<string>(list.flatMap(a => a.client ? [a.client.id] : []));
    if (view === "today") return ids(d?.selected_day ?? []);
    if (view === "week") return ids(d?.this_week ?? []);
    if (view === "not_next") { const next = ids(d?.next_week ?? []); return ids((d?.this_week ?? []).filter(a => a.client && !next.has(a.client.id))); }
    if (view === "not_scheduled") return new Set([...(d?.worklists.not_scheduled ?? []), ...(d?.last_week_nothing_booked ?? []), ...(d?.not_scheduled_after ?? [])].map(c => c.id));
    return null;
  }, [view, clients, dismissedIds, setup.data, renewals.data, schedule.data]);
  const viewBusy = (["today", "week", "not_next", "not_scheduled"].includes(view) && schedule.isPending) || (view === "renewals" && renewals.isPending) || (view === "package" && setup.isPending);
  const viewError = (["today", "week", "not_next", "not_scheduled"].includes(view) && (schedule.error?.message || schedule.data?.error || schedule.data?.worklists.error)) || (view === "renewals" && (renewals.error?.message || renewals.data?.error)) || (view === "package" && (setup.error?.message || setup.data?.error));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byStatus = clients.filter((c) => {
      if (statusFilter === "deleted") return c.deleted_at !== null;
      if (c.deleted_at !== null) return false;
      if (viewIds && !viewIds.has(c.id)) return false;
      const eff = effectiveStatus(c, scheduledSet.has(c.id));
      return matchesStatusFilter(eff, statusFilter);
    });
    return q
      ? byStatus.filter((c) =>
          `${c.first_name} ${c.last_name} ${c.phone ?? ""}`.toLowerCase().includes(q),
        )
      : byStatus;
  }, [search, clients, statusFilter, scheduledSet, viewIds]);




  return (
    <AppShell>
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${filtered.length} of ${clients.length}`}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Client status" className="h-11 w-36 rounded-md border border-input bg-background px-2 text-xs sm:w-auto sm:text-sm"
          >
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_FILTER_LABEL[k]}
              </option>
            ))}
          </select>
          <Link to="/clients/new">
            <Button className="min-h-11">+ Add Client</Button>
          </Link>
        </div>
      </div>


      <div className="mb-4"><label htmlFor="clients-view" className="mb-1 block text-xs font-medium text-muted-foreground">Client filter</label><select id="clients-view" value={view} onChange={e => setView(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-sm">{[["all","All Active"],["package","Needs Package Info"],["renewals","Renewals"],["today","Scheduled Today"],["week","Scheduled This Week"],["not_next","This Week but Not Next"],["not_scheduled","Not Scheduled"]].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {clientError && <p role="alert" className="mb-4 text-destructive">Clients could not load. <Button variant="outline" onClick={() => retryClients()}>Retry</Button></p>}
      {viewError && <p role="alert" className="mb-4 text-destructive">Could not fully read this filter: {viewError} <Button variant="outline" onClick={() => { schedule.refetch(); renewals.refetch(); setup.refetch(); }}>Retry</Button></p>}
      {(viewBusy || isLoading) && <p role="status" className="mb-4 text-muted-foreground">Loading clients…</p>}
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <Input
          aria-label="Search clients" placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      {/* Mobile: stacked client cards */}
      <div className="space-y-2 md:hidden">
        {filtered.map((c) => {
          const owed = totalOwed(c);
          const priceUnknown = packagePriceUnknown(c, dismissedIds?.has(c.id) ?? false);
          return (
            <Link
              key={c.id}
              to="/clients/$id"
              params={{ id: c.id }}
              className="block rounded-md border bg-background p-4 shadow-sm active:bg-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{fullName(c)}</div>
                  {c.phone && (
                    <div className="mt-0.5 truncate text-sm text-muted-foreground">📞 {c.phone}</div>
                  )}
                </div>
                <StatusBadge
                  client={c}
                  isScheduled={scheduledSet.has(c.id)}
                  dismissedFromPackageReview={dismissedIds?.has(c.id) ?? false}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <div className="text-muted-foreground">Package</div>
                <div className="text-right text-foreground truncate">{c.package_name ?? "—"}</div>
                <div className="text-muted-foreground">Visits</div>
                <div className="text-right text-foreground">{progress(c)}</div>
                <div className="text-muted-foreground">Scheduled</div>
                <div className="text-right">{scheduledSet.has(c.id) ? "✅" : "⭕"}</div>
                {!isStaff && (
                  <>
                    <div className="text-muted-foreground">Owed</div>
                    <div
                      className={`text-right font-semibold ${
                        priceUnknown ? "text-amber-800" : owed > 0 ? "text-red-600" : "text-foreground"
                      }`}
                    >
                      {priceUnknown ? "Package info needed" : formatCurrency(owed)}
                    </div>
                  </>
                )}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && !isLoading && !viewBusy && !clientError && !viewError && (
          <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
            No clients found.
          </div>
        )}
      </div>

      {/* Desktop: existing table */}
      <Card className="hidden md:block">
        <CardContent className="pt-6">
          <Input
            aria-label="Search clients" placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-md"
          />
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Scheduled</TableHead>
                  {!isStaff && <TableHead>Amount Owed</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium whitespace-nowrap">{fullName(c)}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.phone ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.package_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{progress(c)}</TableCell>
                    <TableCell>
                      {scheduledSet.has(c.id) ? "✅" : "⭕"}
                    </TableCell>
                    {!isStaff && (
                      <TableCell
                        className={
                          packagePriceUnknown(c, dismissedIds?.has(c.id) ?? false)
                            ? "font-medium text-amber-800 whitespace-nowrap"
                            : totalOwed(c) > 0
                              ? "font-medium text-red-600 whitespace-nowrap"
                              : "whitespace-nowrap"
                        }
                      >
                        {packagePriceUnknown(c, dismissedIds?.has(c.id) ?? false)
                          ? "Package info needed"
                          : formatCurrency(totalOwed(c))}
                      </TableCell>
                    )}
                    <TableCell>
                      <StatusBadge
                        client={c}
                        isScheduled={scheduledSet.has(c.id)}
                        dismissedFromPackageReview={dismissedIds?.has(c.id) ?? false}
                      />
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap">
                      <Link to="/clients/$id" params={{ id: c.id }}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                      <Link to="/clients/$id" params={{ id: c.id }} search={{ edit: 1 }}>
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && !isLoading && !viewBusy && !clientError && !viewError && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      No clients found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

    </AppShell>
  );
}
