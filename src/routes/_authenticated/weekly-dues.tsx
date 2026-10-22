import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { DuesFreshnessBanner, useDuesFreshness } from "@/components/DuesFreshnessBanner";
import { getMasterDues, masterDuesQuery } from "@/lib/master-dues.functions";
import { computeWeeklyDues, KIND_LABEL, matchesWeekly, weekdayIndex, WEEKDAYS, WEEKLY_FILTERS, type WeeklyFilter, type WeeklyItem } from "@/lib/weekly-dues";
import { addDaysYmd, workWeekStartFromYmd } from "@/lib/work-week";

type Search = { week?: "prev" | "current" | "next"; filter?: string };

export const Route = createFileRoute("/_authenticated/weekly-dues")({
  head: () => ({
    meta: [
      { title: "Weekly Dues · FIT Beyond Therapy Admin" },
      { name: "description", content: "Who is expected to pay this work week, prior-week carryover, and older outstanding balances." },
      { property: "og:title", content: "Weekly Dues · FIT Beyond Therapy Admin" },
      { property: "og:description", content: "Who is expected to pay this work week, prior-week carryover, and older outstanding balances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(s.week === "prev" || s.week === "next" || s.week === "current" ? { week: s.week } : {}),
    ...(typeof s.filter === "string" ? { filter: s.filter } : {}),
  }),
  component: WeeklyDuesPage,
});

const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const md = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const range = (a: string, b: string) => (a.slice(5, 7) === b.slice(5, 7) ? `${md(a)}–${Number(b.slice(8))}` : `${md(a)}–${md(b)}`);
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");

function WeeklyDuesPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const fn = useServerFn(getMasterDues);
  const q = useQuery({ ...masterDuesQuery(() => fn()), enabled: isAdmin });
  const fresh = useDuesFreshness(q);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const sel = search.week ?? "current";
  const filter: WeeklyFilter = WEEKLY_FILTERS.some((f) => f.key === search.filter) ? (search.filter as WeeklyFilter) : "all";

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const cur = workWeekStartFromYmd(today);
  const weekStart = sel === "prev" ? addDaysYmd(cur, -7) : sel === "next" ? addDaysYmd(cur, 7) : cur;
  const data = q.data?.data ?? null;
  const w = useMemo(() => (data ? computeWeeklyDues(data.rows, data.appointments, weekStart) : null), [data, weekStart]);

  if (!roleLoading && !isAdmin) return <AppShell><p className="text-muted-foreground">Weekly Dues is available to admins only.</p></AppShell>;

  const shown = w ? w.items.filter((i) => matchesWeekly(i, filter, w.week.start)) : [];
  const expected = shown.filter((i) => i.section === "expected");
  const carry = shown.filter((i) => i.section === "carryover");
  const older = shown.filter((i) => i.section === "older");
  const provisional = w && w.week.priorStart >= cur;

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Weekly Dues</h1>
          <p className="text-sm text-muted-foreground">{w ? `Week of ${range(w.week.start, w.week.end)}` : "Mon–Fri work week"}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["prev", "current", "next"] as const).map((k) => (
            <Button key={k} size="sm" variant={sel === k ? "default" : "outline"} onClick={() => navigate({ search: { week: k, filter }, replace: true })}>
              {k === "prev" ? "Previous" : k === "current" ? "Current" : "Next"}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh"}</Button>
        </div>
      </div>

      {!q.isLoading && <DuesFreshnessBanner q={q} />}
      {q.isLoading || roleLoading ? (
        <p className="text-muted-foreground">Loading from Square…</p>
      ) : q.isError && !q.data ? (
        <Card><CardContent className="p-4 text-destructive">Couldn't load Weekly Dues. {String((q.error as Error)?.message ?? "")}</CardContent></Card>
      ) : q.data?.error || !w ? (
        <Card><CardContent className="p-4"><p className="font-semibold text-destructive">Square unavailable</p><p className="text-sm text-muted-foreground">Totals are hidden rather than shown wrong.</p></CardContent></Card>
      ) : (
        <div className={fresh.untrusted ? "opacity-50" : ""} data-stale={fresh.untrusted || undefined}>
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Expected This Week" value={w.totals.expected} sub={`${w.totals.expectedClients} clients`} />
            <Stat label={provisional ? "Prior Week Carryover (provisional)" : "Prior Week Carryover"} value={w.totals.carryover} sub={`${w.totals.carryoverClients} clients · ${range(w.week.priorStart, addDaysYmd(w.week.priorStart, 4))}`} />
            <Stat label="Older Outstanding" value={w.totals.older} sub={`${w.totals.olderClients} clients`} />
            <Stat label="Total Actionable" value={w.totals.total} sub="expected + carryover + older" />
          </div>

          <div className="mb-4 flex flex-wrap gap-1">
            {WEEKLY_FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => navigate({ search: { week: sel, filter: f.key }, replace: true })}>{f.label}</Button>
            ))}
          </div>

          {expected.length > 0 && <h2 className="mb-2 text-lg font-semibold">Expected This Week</h2>}
          {WEEKDAYS.map((d, i) => {
            const day = expected.filter((x) => weekdayIndex(w.week.start, x.ymd) === i);
            if (!day.length) return null;
            return (
              <section key={d} className="mb-4">
                <h3 className="mb-1 text-sm font-semibold text-muted-foreground">{d} · {md(addDaysYmd(w.week.start, i))} · {$(day.reduce((s, x) => s + x.amount, 0))}</h3>
                <ClientGroups items={day} />
              </section>
            );
          })}

          {carry.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-1 text-lg font-semibold">Prior Week Unpaid Carryover{provisional ? " (provisional — shrinks as payments arrive)" : ""}</h2>
              <ClientGroups items={carry} showDate />
            </section>
          )}
          {older.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-1 text-lg font-semibold">Older Outstanding</h2>
              <ClientGroups items={older} showDate />
            </section>
          )}
          {!shown.length && <p className="text-muted-foreground">Nothing for this filter.</p>}

          <Card className="mt-4"><CardContent className="space-y-1 p-4 text-sm">
            <p>Expected This Week = {$(w.totals.expected)}</p>
            <p>Prior Week Carryover = {$(w.totals.carryover)}</p>
            <p>Older Outstanding = {$(w.totals.older)}</p>
            <p className="font-semibold">Total shown = {$(w.totals.total)}</p>
            <p className="text-muted-foreground">Not due this week (future/prepared renewals, later forecast) = {$(w.totals.excluded)} · Master Dues total = {$(w.totals.masterTotal)}</p>
            <p className={w.totals.unexplained === 0 ? "" : "font-semibold text-destructive"}>Unexplained difference = {$(w.totals.unexplained)}</p>
          </CardContent></Card>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{$(value)}</p><p className="text-xs text-muted-foreground">{sub}</p></CardContent></Card>;
}

function ClientGroups({ items, showDate }: { items: WeeklyItem[]; showDate?: boolean }) {
  const by = new Map<string, WeeklyItem[]>();
  for (const i of items) by.set(i.client_id, [...(by.get(i.client_id) ?? []), i]);
  return (
    <div className="space-y-2">
      {[...by.values()].sort((a, b) => a[0].name.localeCompare(b[0].name)).map((g) => (
        <Card key={g[0].client_id}><CardContent className="p-3">
          <div className="flex justify-between font-medium"><span>{g[0].name}</span><span>{$(g.reduce((s, x) => s + x.amount, 0))}</span></div>
          {g.map((x, k) => (
            <div key={k} className="flex justify-between text-sm text-muted-foreground">
              <span>{KIND_LABEL[x.kind]} · {x.reason}{x.time_iso ? ` · ${time(x.time_iso)}` : ""}{showDate && x.ymd ? ` · ${md(x.ymd)}` : ""}</span>
              {g.length > 1 && <span>{$(x.amount)}</span>}
            </div>
          ))}
        </CardContent></Card>
      ))}
    </div>
  );
}
