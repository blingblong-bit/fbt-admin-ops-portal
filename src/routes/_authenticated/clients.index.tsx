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
  amountOwed,
  effectiveStatus,
  formatCurrency,
  fullName,
  progress,
  type Client,
  type LifecycleStatus,
} from "@/lib/clients";
import { getScheduledClientIds } from "@/lib/schedule.functions";
import { useRole } from "@/hooks/useRole";


export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({ meta: [{ title: "All Clients · FIT Beyond Therapy Admin" }] }),
  component: ClientsListPage,
});

type StatusFilter = "active_assessment" | "active" | "assessment" | "archived" | "deleted" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  active_assessment: "Active + Assessment",
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active_assessment");
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

  const { data: clients = [], isLoading } = useQuery({
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
      return all;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byStatus = clients.filter((c) => {
      if (statusFilter === "deleted") return c.deleted_at !== null;
      if (c.deleted_at !== null) return false;
      const eff = effectiveStatus(c, scheduledSet.has(c.id));
      return matchesStatusFilter(eff, statusFilter);
    });
    return q
      ? byStatus.filter((c) =>
          `${c.first_name} ${c.last_name} ${c.phone ?? ""}`.toLowerCase().includes(q),
        )
      : byStatus;
  }, [search, clients, statusFilter, scheduledSet]);




  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">All Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? "Loading…" : `${filtered.length} of ${clients.length}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 md:h-9 md:py-2"
          >
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_FILTER_LABEL[k]}
              </option>
            ))}
          </select>
          <Link to="/clients/new">
            <Button>+ Add Client</Button>
          </Link>
        </div>
      </div>


      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b bg-slate-50/95 px-4 py-2 backdrop-blur md:hidden">
        <Input
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      {/* Mobile: stacked client cards */}
      <div className="space-y-2 md:hidden">
        {filtered.map((c) => {
          const owed = amountOwed(c);
          return (
            <Link
              key={c.id}
              to="/clients/$id"
              params={{ id: c.id }}
              className="block rounded-xl border bg-white p-4 shadow-sm active:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{fullName(c)}</div>
                  {c.phone && (
                    <div className="mt-0.5 truncate text-sm text-slate-500">📞 {c.phone}</div>
                  )}
                </div>
                <StatusBadge client={c} isScheduled={scheduledSet.has(c.id)} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <div className="text-slate-500">Package</div>
                <div className="text-right text-slate-800 truncate">{c.package_name ?? "—"}</div>
                <div className="text-slate-500">Visits</div>
                <div className="text-right text-slate-800">{progress(c)}</div>
                <div className="text-slate-500">Scheduled</div>
                <div className="text-right">{scheduledSet.has(c.id) ? "✅" : "⭕"}</div>
                <div className="text-slate-500">Owed</div>
                <div className={`text-right font-semibold ${owed > 0 ? "text-red-600" : "text-slate-700"}`}>
                  {formatCurrency(owed)}
                </div>
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">
            No clients found.
          </div>
        )}
      </div>

      {/* Desktop: existing table */}
      <Card className="hidden md:block">
        <CardContent className="pt-6">
          <Input
            placeholder="Search…"
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
                  <TableHead>Amount Owed</TableHead>
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
                    <TableCell className={amountOwed(c) > 0 ? "font-medium text-red-600 whitespace-nowrap" : "whitespace-nowrap"}>
                      {formatCurrency(amountOwed(c))}
                    </TableCell>
                    <TableCell>
                      <StatusBadge client={c} isScheduled={scheduledSet.has(c.id)} />
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
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
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
