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
      return data as Client[];
    },
  });
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
    () =>
      [...clients]
        .filter((c) => amountOwed(c) > 0)
        .sort((a, b) => amountOwed(b) - amountOwed(a)),
    [clients],
  );

  const endingSoon = useMemo(
    () =>
      [...clients]
        .filter((c) => c.package_total_visits > 0 && visitsRemaining(c) <= 2 && visitsRemaining(c) > 0)
        .sort((a, b) => visitsRemaining(a) - visitsRemaining(b)),
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

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Search Clients</CardTitle>
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
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.id }}
                        className="font-medium hover:underline"
                      >
                        {fullName(c)}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {progress(c)} · {c.package_name ?? "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-red-600">
                        {formatCurrency(amountOwed(c))}
                      </div>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.id }}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Packages Ending Soon
              <span className="text-xs font-normal text-slate-500">{endingSoon.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {endingSoon.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing ending in the next 2 visits.</p>
            ) : (
              <ul className="divide-y">
                {endingSoon.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.id }}
                        className="font-medium hover:underline"
                      >
                        {fullName(c)}
                      </Link>
                      <div className="text-xs text-slate-500">{c.package_name ?? "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-amber-700">
                        {visitsRemaining(c)} visit{visitsRemaining(c) === 1 ? "" : "s"} left
                      </div>
                      <div className="text-xs text-slate-500">{progress(c)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

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
                <li key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      to="/clients/$id"
                      params={{ id: c.id }}
                      className="font-medium hover:underline"
                    >
                      {fullName(c)}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {progress(c)} · {c.package_name ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge client={c} />
                    <span className="text-xs text-slate-400">
                      {new Date(c.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
