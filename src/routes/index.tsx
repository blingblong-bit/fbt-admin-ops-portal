import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  amountOwed,
  formatCurrency,
  fullName,
  progress,
  visitsRemaining,
  type Client,
} from "@/lib/clients";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard · FIT Beyond Therapy Admin" }] }),
  component: Dashboard,
});

function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Client[];
    },
  });
}

function ScheduledPill({ scheduled }: { scheduled: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        scheduled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {scheduled ? "✅ Scheduled" : "⭕ Not Scheduled"}
    </span>
  );
}

function ClientRow({ c }: { c: Client }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/clients/$id"
            params={{ id: c.id }}
            className="font-medium hover:underline"
          >
            {fullName(c)}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{c.package_name ?? "No package"}</span>
            <span>·</span>
            <span>Progress: {progress(c)}</span>
            <ScheduledPill scheduled={c.is_scheduled} />
          </div>
          {c.internal_notes && (
            <div className="mt-1 line-clamp-1 text-xs text-slate-500">📝 {c.internal_notes}</div>
          )}
        </div>
        <div className="text-right">
          <div
            className={`text-sm font-semibold ${
              amountOwed(c) > 0 ? "text-red-600" : "text-slate-700"
            }`}
          >
            {amountOwed(c) > 0 ? formatCurrency(amountOwed(c)) : "Paid"}
          </div>
          <StatusBadge client={c} />
        </div>
      </div>
    </li>
  );
}

function Dashboard() {
  const { data: clients = [], isLoading } = useClients();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return clients.filter((c) =>
      `${c.first_name} ${c.last_name} ${c.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [search, clients]);

  const needsPayment = useMemo(
    () => [...clients].filter((c) => amountOwed(c) > 0).sort((a, b) => amountOwed(b) - amountOwed(a)),
    [clients],
  );

  const notScheduled = useMemo(
    () =>
      clients.filter((c) => {
        if (c.is_scheduled) return false;
        const r = visitsRemaining(c);
        // Either has visits remaining, or visit tracking is off (default to listing them).
        if (r === null) return true;
        return r > 0;
      }),
    [clients],
  );

  const activePackages = useMemo(
    () =>
      clients.filter((c) => {
        const r = visitsRemaining(c);
        return r === null || r > 0;
      }),
    [clients],
  );

  const recent = useMemo(() => clients.slice(0, 6), [clients]);

  return (
    <AppShell>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? "Loading…" : `${clients.length} clients tracked`}
          </p>
        </div>
        <Link to="/clients/new">
          <Button>+ Add Client</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Needs Payment
              <span className="text-xs font-normal text-slate-500">{needsPayment.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {needsPayment.length === 0 ? (
              <p className="text-sm text-slate-500">Everyone is paid up. 🎉</p>
            ) : (
              <ul className="divide-y">
                {needsPayment.map((c) => (
                  <ClientRow key={c.id} c={c} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Not Scheduled
              <span className="text-xs font-normal text-slate-500">{notScheduled.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notScheduled.length === 0 ? (
              <p className="text-sm text-slate-500">Everyone is on the calendar.</p>
            ) : (
              <ul className="max-h-[480px] divide-y overflow-y-auto">
                {notScheduled.map((c) => (
                  <ClientRow key={c.id} c={c} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Active Packages
            <span className="text-xs font-normal text-slate-500">{activePackages.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activePackages.length === 0 ? (
            <p className="text-sm text-slate-500">No active packages.</p>
          ) : (
            <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {activePackages.map((c) => (
                <ClientRow key={c.id} c={c} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recently Updated</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No clients yet. Add your first one.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((c) => (
                <ClientRow key={c.id} c={c} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search by first name, last name, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xl"
          />
          {search && (
            <div className="mt-4 divide-y rounded-lg border bg-white">
              {filtered.length === 0 && (
                <div className="p-4 text-sm text-slate-500">No matches.</div>
              )}
              {filtered.map((c) => (
                <Link
                  key={c.id}
                  to="/clients/$id"
                  params={{ id: c.id }}
                  className="flex items-center justify-between p-4 hover:bg-slate-50"
                >
                  <div>
                    <div className="font-medium">{fullName(c)}</div>
                    <div className="text-xs text-slate-500">
                      {c.phone ?? "no phone"} · {c.package_name ?? "no package"}
                    </div>
                  </div>
                  <StatusBadge client={c} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
