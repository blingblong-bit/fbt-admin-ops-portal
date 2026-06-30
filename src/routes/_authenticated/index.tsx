import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  CircleSlash,
  Hourglass,
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
  formatCurrency,
  fullName,
  visitsRemaining,
  type Client,
} from "@/lib/clients";
import { getScheduledClientIds } from "@/lib/schedule.functions";


export const Route = createFileRoute("/_authenticated/")({
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
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Client[];
    },
  });
}

type FilterKey =
  | "all"
  | "payment_due"
  | "not_scheduled"
  | "almost_finished"
  | "critical"
  | "package_complete";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All Active",
  payment_due: "Payment Due",
  not_scheduled: "Not Scheduled",
  almost_finished: "Almost Finished",
  critical: "Critical",
  package_complete: "Package Complete",
};

function matchesFilter(c: Client, f: FilterKey, isScheduled: boolean): boolean {
  const owed = amountOwed(c);
  const r = visitsRemaining(c);
  switch (f) {
    case "all":
      return true;
    case "payment_due":
      return owed > 0;
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
  const { data: clients = [], isLoading } = useClients();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("payment_due");

  const counts = useMemo(() => {
    const c = {
      all: 0,
      payment_due: 0,
      payment_due_total: 0,
      not_scheduled: 0,
      almost_finished: 0,
      critical: 0,
      critical_total: 0,
      package_complete: 0,
    };
    for (const cl of clients) {
      const owed = amountOwed(cl);
      const r = visitsRemaining(cl);
      c.all += 1;
      if (owed > 0) {
        c.payment_due += 1;
        c.payment_due_total += owed;
      }
      if (!cl.is_scheduled) c.not_scheduled += 1;
      if (r !== null && r > 0 && r <= 2) c.almost_finished += 1;
      if (owed > 0 && r !== null && r <= 2) {
        c.critical += 1;
        c.critical_total += owed;
      }
      if (r !== null && cl.package_total_visits > 0 && r === 0)
        c.package_complete += 1;
    }
    return c;
  }, [clients]);

  const filtered = useMemo(() => {
    const list = clients.filter((c) => matchesFilter(c, filter));
    const q = search.trim().toLowerCase();
    const searched = q
      ? list.filter((c) =>
          `${c.first_name} ${c.last_name} ${c.phone ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : list;
    // Sort: payment-due-ish filters by balance desc; others by name
    if (filter === "payment_due" || filter === "critical") {
      return [...searched].sort((a, b) => amountOwed(b) - amountOwed(a));
    }
    if (filter === "almost_finished") {
      return [...searched].sort(
        (a, b) => (visitsRemaining(a) ?? 0) - (visitsRemaining(b) ?? 0),
      );
    }
    return [...searched].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [clients, filter, search]);

  const tiles: TileDef[] = [
    {
      key: "payment_due",
      label: "Payment Due",
      icon: <CircleDollarSign className="h-5 w-5" />,
      count: counts.payment_due,
      money: counts.payment_due_total,
      moneyLabel: "outstanding",
      tone: "red",
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
      money: counts.critical_total,
      moneyLabel: "outstanding",
      tone: "red",
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

      {/* Tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Tile
            key={t.key}
            tile={t}
            active={filter === t.key}
            onClick={() => setFilter(t.key)}
          />
        ))}
      </div>

      {/* Filtered list */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Showing: {FILTER_LABEL[filter]}
          </h2>
          <span className="text-sm text-slate-500">{filtered.length}</span>
        </div>

        <Card className="mb-4">
          <CardContent className="pt-6">
            <Input
              placeholder="Search within this view by name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 text-base"
            />
          </CardContent>
        </Card>

        {filter === "payment_due" && filtered.length > 0 && (
          <PaymentTotals clients={filtered} />
        )}

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
            {search
              ? "No matches in this view."
              : `No clients in “${FILTER_LABEL[filter]}”.`}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <SmartClientCard key={c.id} client={c} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

type TileDef = {
  key: FilterKey;
  label: string;
  icon: React.ReactNode;
  count: number;
  money?: number;
  moneyLabel?: string;
  tone: "red" | "amber" | "slate";
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow ${
        active ? `ring-2 ${activeRing}` : ""
      }`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone}`}>
        {tile.icon}
      </div>
      <div className="text-sm font-medium text-slate-600">{tile.label}</div>
      <div className="text-2xl font-semibold tracking-tight text-slate-900">
        {tile.count}
        <span className="ml-1 text-sm font-normal text-slate-500">
          {tile.count === 1 ? "client" : "clients"}
        </span>
      </div>
      {tile.money !== undefined && tile.money > 0 && (
        <div className="text-xs font-medium text-slate-600">
          {formatCurrency(tile.money)} {tile.moneyLabel}
        </div>
      )}
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

// Keep StatusBadge import used elsewhere referenced to avoid unused-import noise
void StatusBadge;
