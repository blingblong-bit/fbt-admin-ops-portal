import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { DuesFreshnessBanner, useDuesFreshness } from "@/components/DuesFreshnessBanner";
import { getMasterDues, masterDuesQuery } from "@/lib/master-dues.functions";
import { DUES_FILTERS, filterTotals, makeWeekOf, matchesFilter, sortRows, sumRows, type DuesFilter } from "@/lib/master-dues-view";
import type { MasterDuesRow, ObligationStatus } from "@/lib/master-dues";
import { addDaysYmd, workWeekStartFromYmd } from "@/lib/work-week";

export const Route = createFileRoute("/_authenticated/payment-due")({
  head: () => ({
    meta: [
      { title: "Payment Due · FIT Beyond Therapy Admin" },
      { name: "description", content: "Master dues: every client balance and prepared renewal in one list." },
      { property: "og:title", content: "Payment Due · FIT Beyond Therapy Admin" },
      { property: "og:description", content: "Master dues: every client balance and prepared renewal in one list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { filter?: string } => (typeof s.filter === "string" ? { filter: s.filter } : {}),
  component: PaymentDuePage,
});

const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const STATUS: Record<ObligationStatus, string> = {
  due_now: "Due Now", upcoming: "Upcoming", prepared: "Prepared — No Scheduled Start", needs_review: "Needs Review", none: "",
};
const WINDOW: Record<string, string> = { this_week: "Expected this week", next_week: "Expected next week", later: "Expected later", unknown: "No appointment / unknown" };
const fmtYmd = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—");

function PaymentDuePage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const fn = useServerFn(getMasterDues);
  const q = useQuery({ ...masterDuesQuery(() => fn()), enabled: isAdmin });
  const fresh = useDuesFreshness(q);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter: DuesFilter = DUES_FILTERS.some((f) => f.key === search.filter) ? (search.filter as DuesFilter) : "all";
  const setFilter = (f: DuesFilter) => navigate({ search: { filter: f }, replace: true });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekOf = makeWeekOf(today, workWeekStartFromYmd, addDaysYmd);
  const data = q.data?.data ?? null;
  const shown = useMemo(() => (data ? sortRows(data.rows.filter((r) => matchesFilter(r, filter, weekOf)), weekOf) : []), [data, filter]);
  const shownTotals = data ? filterTotals(data.rows, filter, weekOf) : { clients: 0, dollars: 0 };

  if (!roleLoading && !isAdmin) {
    return <AppShell><p className="text-muted-foreground">Payment Due is available to admins only.</p></AppShell>;
  }

  const t = data?.totals;
  const allSum = data ? sumRows(data.rows) : 0;
  const diff = t ? Math.round((t.total - allSum) * 100) / 100 : 0;
  const pkgInfo = data?.exceptions.filter((e) => e.kind === "package_info_needed") ?? [];
  const ppv = data?.exceptions.filter((e) => e.kind === "pay_per_visit") ?? [];
  const billingEx = data?.exceptions.filter((e) => e.kind === "billing_setup_needed" || e.kind === "billing_review") ?? [];

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Payment Due</h1>
          <p className="text-sm text-muted-foreground">Master dues — every balance and prepared renewal, one row per client.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh"}</Button>
      </div>

      {!q.isLoading && <DuesFreshnessBanner q={q} />}
      {q.isLoading || roleLoading ? (
        <p className="text-muted-foreground">Loading master dues from Square…</p>
      ) : q.isError && !q.data ? (
        <Card><CardContent className="p-4 text-destructive">Couldn't load Payment Due. {String((q.error as Error)?.message ?? "")}</CardContent></Card>
      ) : q.data?.error || !data || !t ? (
        <Card><CardContent className="p-4"><p className="font-semibold text-destructive">Square unavailable</p><p className="text-sm text-muted-foreground">Totals are hidden rather than shown wrong. Try Refresh in a minute.</p></CardContent></Card>
      ) : (
        <div className={fresh.untrusted ? "opacity-50" : ""} data-stale={fresh.untrusted || undefined}>
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Summary label="Master Dues Total" clients={t.clients} dollars={t.total} strong />
            <Summary label="Owed Now" clients={filterTotals(data.rows, "due_now", weekOf).clients} dollars={filterTotals(data.rows, "due_now", weekOf).dollars} note={t.renewalByStatus.due_now.dollars > 0 ? `incl. ${$(t.renewalByStatus.due_now.dollars)} started renewals` : undefined} />
            <Summary label="Upcoming Renewals" clients={t.renewalByStatus.upcoming.clients} dollars={t.renewalByStatus.upcoming.dollars} />
            <Summary label="Prepared — No Scheduled Start" clients={t.renewalByStatus.prepared.clients} dollars={t.renewalByStatus.prepared.dollars} />
            <Summary label="Pay-per-visit / Weekly" clients={t.billing.clients} dollars={t.billing.dollars} note={t.carryover.dollars > 0 ? `${$(t.carryover.dollars)} carryover` : undefined} />
            <Summary label="Needs Review" clients={t.renewalByStatus.needs_review.clients} dollars={t.renewalByStatus.needs_review.dollars} />
          </div>
          <p className="mb-4 text-xs text-muted-foreground">Client counts can overlap when one client has money in more than one category. Dollars never double count.</p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {DUES_FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>{f.label}</Button>
            ))}
          </div>
          <p className="mb-3 text-sm">
            Shown: <b>{shownTotals.clients}</b> clients, <b>{$(shownTotals.dollars)}</b>
            {filter === "all" && <> · Difference from total: <b className={diff === 0 ? "" : "text-destructive"}>{$(diff)}</b></>}
          </p>

          <div className="space-y-2">
            {shown.map((r) => <DuesCard key={r.client_id} r={r} />)}
            {shown.length === 0 && <p className="text-muted-foreground">No clients in this filter.</p>}
          </div>

          {(ppv.length > 0 || pkgInfo.length > 0 || billingEx.length > 0) && (
            <div className="mt-8">
              <h2 className="mb-1 text-lg font-semibold">Dues Exceptions</h2>
              <p className="mb-3 text-sm text-muted-foreground">Not counted in the total — no dependable dollar amount yet.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <ExceptionList title="Pay-per-visit" items={ppv} />
                <ExceptionList title="Package Info Needed" items={pkgInfo} />
                {billingEx.length > 0 && <ExceptionList title="Billing Setup / Review" items={billingEx} />}
              </div>
            </div>
          )}
          <p className="mt-6 text-xs text-muted-foreground">Computed {new Date(q.data!.computed_at).toLocaleString()}</p>
        </div>
      )}
    </AppShell>
  );
}

function Summary({ label, clients, dollars, strong, note }: { label: string; clients: number; dollars: number; strong?: boolean; note?: string }) {
  return (
    <Card className={strong ? "border-primary" : ""}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`font-semibold ${strong ? "text-2xl" : "text-xl"}`}>{$(dollars)}</div>
        <div className="text-xs text-muted-foreground">{clients} client{clients === 1 ? "" : "s"}{note ? ` · ${note}` : ""}</div>
      </CardContent>
    </Card>
  );
}

function DuesCard({ r }: { r: MasterDuesRow }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link to="/clients/$id" params={{ id: r.client_id }} className="font-semibold hover:underline">{r.name}</Link>
          <span className="text-lg font-semibold">{$(r.total)}</span>
        </div>
        <div className="grid gap-1 text-sm sm:grid-cols-3">
          {r.previous.amount > 0 && <Bucket label="Previous debt" amount={r.previous.amount} status={STATUS[r.previous.status]} />}
          {r.current.amount > 0 && <Bucket label="Current balance" amount={r.current.amount} status={STATUS[r.current.status]} sub={r.current.expected ? WINDOW[r.current.expected] : undefined} />}
          {r.billing.amount > 0 && <Bucket label={r.billing.type === "weekly" ? "Weekly billing" : "Pay-per-visit"} amount={r.billing.amount} status={r.billing.due_now > 0 ? `${$(r.billing.due_now)} Due Now` : "Upcoming"} sub={r.billing.obligations.filter((o) => o.status !== "needs_billing_review").map((o) => `${o.kind === "week" ? "Wk " : ""}${fmtYmd(o.ymd)} ${$(o.open)}${o.expected === "past" ? " (carryover)" : o.status === "upcoming" ? " (upcoming)" : ""}`).join(" · ")} />}
          {r.renewal.amount > 0 && <Bucket label="Renewal" amount={r.renewal.amount} status={STATUS[r.renewal.status]} sub={r.renewal.expected_ymd ? `Expected ${fmtYmd(r.renewal.expected_ymd)}` : undefined} />}
        </div>
        {r.reasons.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{r.reasons.join(" · ")}</p>}
      </CardContent>
    </Card>
  );
}

function Bucket({ label, amount, status, sub }: { label: string; amount: number; status: string; sub?: string }) {
  return (
    <div className="rounded-md border bg-muted/40 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{$(amount)} <span className="text-xs font-normal text-muted-foreground">· {status}</span></div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ExceptionList({ title, items }: { title: string; items: { client_id: string; name: string; reason: string }[] }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 font-medium">{title} ({items.length})</div>
        <ul className="space-y-1 text-sm">
          {items.map((e) => (
            <li key={e.client_id}><Link to="/clients/$id" params={{ id: e.client_id }} className="hover:underline">{e.name}</Link> <span className="text-muted-foreground">— {e.reason}</span></li>
          ))}
          {items.length === 0 && <li className="text-muted-foreground">None</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
