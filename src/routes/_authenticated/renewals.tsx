import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PreRenewCard } from "@/components/PreRenewCard";
import { formatDate } from "@/lib/clients";
import { getRenewalForecast, type RenewalForecastRow } from "@/lib/schedule.functions";
import { attentionReason, groupRenewals } from "@/lib/renewals-view";
import { chunk } from "@/lib/chunk";
import { SearchBox } from "@/components/SearchBox";
import { filterByName, normalizeQuery } from "@/lib/name-search";

export const Route = createFileRoute("/_authenticated/renewals")({
  head: () => ({
    meta: [
      { title: "Renewals · FIT Beyond Therapy Admin" },
      { name: "description", content: "Clients who need a renewal, prepared renewals, and renewals needing attention." },
      { property: "og:title", content: "Renewals · FIT Beyond Therapy Admin" },
      { property: "og:description", content: "Track renewals that are needed, scheduled, or need attention." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RenewalsPage,
});

type Tab = "needs" | "scheduled" | "attention";

function RenewalsPage() {
  const fetchForecast = useServerFn(getRenewalForecast);
  // Bounded retries: a slow Square read must end in a visible error, not endless "Loading…".
  const forecastQ = useQuery({
    queryKey: ["renewal-forecast"],
    queryFn: () => fetchForecast(),
    staleTime: 60_000,
    retry: 1,
  });
  const rows = forecastQ.data?.rows ?? [];
  const ids = useMemo(() => rows.map((r) => r.client_id).sort(), [rows]);
  const namesQ = useQuery({
    queryKey: ["clients", "renewal-names", ids.join(",")],
    enabled: ids.length > 0,
    retry: 1,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const map = new Map<string, string>();
      for (const part of chunk(ids, 100)) {
        const { data, error } = await supabase.from("clients").select("id, first_name, last_name").in("id", part);
        if (error) throw error;
        for (const c of data ?? []) map.set(c.id, `${c.first_name} ${c.last_name}`.trim());
      }
      return map;
    },
  });
  const groups = useMemo(() => groupRenewals(rows), [rows]);
  const [tab, setTab] = useState<Tab>("needs");

  const tabs: { key: Tab; label: string; help: string; list: RenewalForecastRow[] }[] = [
    { key: "needs", label: "Needs Renewal", help: "Booked visits go past the current package. Prepare the next package.", list: groups.needs },
    { key: "scheduled", label: "Scheduled", help: "Next package is prepared. It starts only when Square shows visit 1 of N at check-in — never by date alone.", list: groups.scheduled },
    { key: "attention", label: "Needs Attention", help: "Something needs a staff look before this renewal can be trusted.", list: groups.attention },
  ];
  const current = tabs.find((t) => t.key === tab)!;
  const [query, setQuery] = useState("");
  const searching = normalizeQuery(query) !== "";
  const nameOf = (r: RenewalForecastRow) => namesQ.data?.get(r.client_id) ?? "";
  // Display-only filter; tab counts below always use the full groups.
  const visible = filterByName(current.list, query, nameOf);
  const matchCount = (l: RenewalForecastRow[]) => filterByName(l, query, nameOf).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Renewals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            "Can start on or after" is the earliest day a prepared package is allowed to begin. It does not start the
            package by itself — the package starts at the first check-in Square marks as 1 of N on or after that day.
          </p>
        </div>
        {forecastQ.data?.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Square couldn't be read just now, so this list may be incomplete: {forecastQ.data.error}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg border p-4 text-left transition ${tab === t.key ? "border-primary bg-primary/5" : "bg-card"}`}
            >
              <div className="text-sm text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-semibold">{t.list.length}</div>
              {searching && <div className="text-xs text-muted-foreground">{matchCount(t.list)} match</div>}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{current.help}</p>
        <SearchBox value={query} onChange={setQuery} />
        {forecastQ.data && (
          <p className="text-xs text-muted-foreground">
            {forecastQ.isFetching ? "Updating… " : ""}
            Last updated {new Date(forecastQ.dataUpdatedAt).toLocaleTimeString()}
            {forecastQ.isError ? " · Out of date: the latest refresh failed." : ""}
          </p>
        )}
        {forecastQ.isError && !forecastQ.data ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <span>Renewals couldn't load. Nothing has changed, it just didn't finish reading.</span>
            <Button size="sm" variant="outline" onClick={() => forecastQ.refetch()} disabled={forecastQ.isFetching}>
              {forecastQ.isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : forecastQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading… reading Square appointments can take up to 20 seconds.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{searching ? "No client in this tab matches that name." : "Nobody here right now."}</p>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => (
              <Card key={r.client_id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{namesQ.data?.get(r.client_id) ?? "Client"}</div>
                      <div className="text-xs text-muted-foreground">
                        {attentionReason(r) ??
                          (r.no_upcoming ? "No upcoming appointment" : `Next package expected ${formatDate(r.first_uncovered_ymd)} (from Square)`)}
                        {r.pending_start_ymd ? ` · Can start on or after ${formatDate(r.pending_start_ymd)}` : ""}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/clients/$id" params={{ id: r.client_id }}>Open profile</Link>
                    </Button>
                  </div>
                  <PreRenewCard forecast={r} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
