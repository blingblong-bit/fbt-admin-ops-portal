import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { SmartClientCard } from "@/components/SmartClientCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  amountOwed,
  formatCurrency,
  fullName,
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

  const notScheduled = useMemo(
    () =>
      clients
        .filter((c) => {
          if (c.is_scheduled) return false;
          if (amountOwed(c) > 0) return false; // already handled in Needs Payment
          const r = visitsRemaining(c);
          if (r === null) return true;
          return r > 0;
        })
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [clients],
  );

  const recent = useMemo(() => clients.slice(0, 6), [clients]);

  return (
    <AppShell>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? "Loading…" : `${clients.length} clients tracked`}
          </p>
        </div>
        <Link to="/clients/new">
          <Button>+ Add Client</Button>
        </Link>
      </div>

      {/* Search — always at top */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <Input
            placeholder="Search clients by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 text-base"
          />
          {search && (
            <div className="mt-4 divide-y rounded-lg border bg-white">
              {filtered.length === 0 && (
                <div className="p-4 text-sm text-slate-500">No matches.</div>
              )}
              {filtered.slice(0, 8).map((c) => (
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

      {/* Needs Payment */}
      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            💰 Needs Payment
          </h2>
          <span className="text-sm text-slate-500">{needsPayment.length}</span>
        </div>
        {needsPayment.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
            Everyone is paid up.
          </p>
        ) : (
          <>
            <PaymentTotals clients={needsPayment} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {needsPayment.map((c) => (
                <SmartClientCard key={c.id} client={c} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Not Scheduled */}
      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            📅 Not Scheduled
          </h2>
          <span className="text-sm text-slate-500">{notScheduled.length}</span>
        </div>
        {notScheduled.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
            Everyone is on the calendar.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notScheduled.map((c) => (
              <SmartClientCard key={c.id} client={c} />
            ))}
          </div>
        )}
      </section>

      {/* Recently Updated — compact */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-slate-600">
            Recently Updated
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No clients yet.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <Link
                    to="/clients/$id"
                    params={{ id: c.id }}
                    className="text-sm font-medium hover:underline"
                  >
                    {fullName(c)}
                  </Link>
                  <StatusBadge client={c} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
