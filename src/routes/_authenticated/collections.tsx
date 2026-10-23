import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { SearchBox } from "@/components/SearchBox";
import { filterByName, normalizeQuery } from "@/lib/name-search";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { DuesFreshnessBanner, useDuesFreshness } from "@/components/DuesFreshnessBanner";
import { getMasterDues, masterDuesQuery } from "@/lib/master-dues.functions";
import { byClient, computeCollections, type CollectionGroup, type CollectionItem } from "@/lib/collections";
import { addDaysYmd, chicagoYmd, collectionWeekStart } from "@/lib/work-week";

type Tab = "week" | "past" | "next" | "upcoming" | "all";
const TABS: { key: Tab; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "past", label: "Due Now" },
  { key: "next", label: "Next Week" },
  { key: "upcoming", label: "Not Due Yet" },
  { key: "all", label: "All Balances" },
];

export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({
    meta: [
      { title: "Collections · FIT Beyond Therapy Admin" },
      { name: "description", content: "Front-desk collections: who to collect from this week, past-due balances, and upcoming renewals." },
      { property: "og:title", content: "Collections · FIT Beyond Therapy Admin" },
      { property: "og:description", content: "Front-desk collections: who to collect from this week, past-due balances, and upcoming renewals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    TABS.some((t) => t.key === s.tab) ? { tab: s.tab as Tab } : {},
  component: CollectionsPage,
});

const $ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const md = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");
const GROUP_TONE: Record<CollectionGroup, string> = {
  thisWeek: "bg-primary/10 text-primary",
  pastDue: "bg-destructive/10 text-destructive",
  nextWeek: "bg-secondary text-secondary-foreground",
  upcoming: "bg-muted text-muted-foreground",
  review: "bg-accent text-accent-foreground",
};
const GROUP_NAME: Record<CollectionGroup, string> = { thisWeek: "This week", pastDue: "Past due", nextWeek: "Next week", upcoming: "Not due yet", review: "Needs review" };

function CollectionsPage() {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const fn = useServerFn(getMasterDues);
  const q = useQuery({ ...masterDuesQuery(() => fn()), enabled: isAdmin });
  const fresh = useDuesFreshness(q);
  const tab: Tab = Route.useSearch().tab ?? "week";
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");

  // Rolls to next week at Saturday 00:00 Chicago; "Previous week" shows the prior list live.
  const [viewPrev, setViewPrev] = useState(false);
  const curStart = collectionWeekStart();
  const weekend = [0, 6].includes(new Date(`${chicagoYmd()}T12:00:00Z`).getUTCDay());
  const weekStart = viewPrev ? addDaysYmd(curStart, -7) : curStart;
  const data = q.data?.data ?? null;
  const c = useMemo(() => (data ? computeCollections(data.rows, data.appointments, data.exceptions, weekStart) : null), [data, weekStart]);

  if (!roleLoading && !isAdmin) return <AppShell><p className="text-muted-foreground">Collections is available to admins only.</p></AppShell>;

  // Search filters displayed rows only; totals above always come from the full `c`.
  const shown = c ? filterByName(c.items, query, (i) => i.name) : [];
  const shownExceptions = c ? filterByName(c.exceptions, query, (e) => e.name) : [];
  const pick = (g: CollectionGroup[]) => shown.filter((i) => g.includes(i.group));
  const weekItems = pick(["thisWeek"]);
  const searching = normalizeQuery(query) !== "";

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Collections</h1>
          <p className="text-sm text-muted-foreground">
            {c ? `Week of ${md(c.week.start)} – ${md(c.week.end)}` : "Mon–Fri work week"} · who to collect from, and why
          </p>
          {viewPrev ? (
            <p className="text-xs text-destructive">Viewing the previous week with today's balances (payments since then are reflected).</p>
          ) : weekend ? (
            <p className="text-xs text-muted-foreground">Weekend: this is next week's worklist. Unpaid amounts from last week are under Carried over.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant={viewPrev ? "default" : "ghost"} size="sm" onClick={() => setViewPrev((v) => !v)}>
            {viewPrev ? "Back to current week" : "Previous week"}
          </Button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Detailed views ▾</summary>
            <div className="absolute right-0 z-10 mt-1 grid w-48 rounded-md border bg-popover p-1 shadow-md">
              <Link to="/payment-due" className="rounded px-2 py-1.5 text-sm hover:bg-muted">Payment Due ledger</Link>
              <Link to="/weekly-dues" className="rounded px-2 py-1.5 text-sm hover:bg-muted">Weekly Dues</Link>
            </div>
          </details>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh"}</Button>
        </div>
      </div>

      {!q.isLoading && <DuesFreshnessBanner q={q} />}
      {q.isLoading || roleLoading ? (
        <p className="text-muted-foreground">Loading from Square…</p>
      ) : q.isError && !q.data ? (
        <Card><CardContent className="p-4 text-destructive">Couldn't load Collections. {String((q.error as Error)?.message ?? "")}</CardContent></Card>
      ) : q.data?.error || !c ? (
        <Card><CardContent className="p-4"><p className="font-semibold text-destructive">Square unavailable</p><p className="text-sm text-muted-foreground">Totals are hidden rather than shown wrong. Try Refresh in a minute.</p></CardContent></Card>
      ) : (
        <div className={fresh.untrusted ? "opacity-50" : ""} data-stale={fresh.untrusted || undefined}>
          <div className="mb-1 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="This Week" hint={`${$(c.totals.pastDue.dollars)} carried over / due now + ${$(c.totals.thisWeek.dollars)} scheduled this week`} t={c.totals.thisWeekAll} tone="text-primary" onClick={() => navigate({ search: { tab: "week" }, replace: true })} />
            <Stat label={`Next Week · ${md(c.week.nextStart)}`} hint="new charges only" t={c.totals.nextWeek} onClick={() => navigate({ search: { tab: "next" }, replace: true })} />
            <Stat label="Not Due Yet" hint="Next packages not started" t={c.totals.upcoming} onClick={() => navigate({ search: { tab: "upcoming" }, replace: true })} />
            <Stat label="Needs Review" hint="Check before collecting" t={c.totals.review} onClick={() => navigate({ search: { tab: "all" }, replace: true })} />
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Master total: <b className="text-foreground">{$(c.totals.masterTotal)}</b> = This Week + Next Week + Not Due Yet + Needs Review. Due now ({$(c.totals.pastDue.dollars)}, {c.totals.pastDue.clients} clients) is already inside This Week.
            {c.totals.unexplained !== 0 && <b className="text-destructive"> Unexplained difference {$(c.totals.unexplained)} — use Payment Due.</b>}
          </p>

          <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => navigate({ search: { tab: t.key }, replace: true })}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <SearchBox value={query} onChange={setQuery} />
          {searching && (
            <p className="mb-3 text-xs text-muted-foreground">
              Showing clients matching “{query.trim()}” · {new Set(shown.map((i) => i.client_id)).size} across all tabs. Totals above are unchanged.
            </p>
          )}

          {tab === "week" && (
            <>
              {pick(["pastDue"]).length > 0 && (
                <section className="mb-5">
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-destructive">Due now — unpaid from before · {$(c.totals.pastDue.dollars)}</h2>
                  <ClientList items={pick(["pastDue"])} empty="" />
                </section>
              )}
              <WeekTab items={weekItems} weekStart={c.week.start} empty={searching ? (pick(["pastDue"]).length ? "" : "No client matches that name this week.") : undefined} />
            </>
          )}
          {tab === "next" && (
            <>
              <p className="mb-3 text-sm text-muted-foreground">Only new charges for {md(c.week.nextStart)} – {md(c.week.nextEnd)}. Older unpaid balances stay under This Week. Anything here that isn't paid moves into This Week when the week starts.</p>
              <ClientList items={pick(["nextWeek"])} empty={searching ? "No client matches that name." : "Nothing new expected next week."} />
            </>
          )}
          {tab === "past" && <ClientList items={pick(["pastDue"])} empty={searching ? "No client matches that name." : "No past-due balances."} />}
          {tab === "upcoming" && (
            <>
              <p className="mb-3 text-sm text-muted-foreground">Not owed yet. These become due when the new package actually starts in Square.</p>
              <ClientList items={pick(["upcoming"])} empty={searching ? "No client matches that name." : "No upcoming renewals."} />
            </>
          )}
          {tab === "all" && (
            <>
              <ClientList items={shown} empty={searching ? "No client matches that name." : "No balances."} showGroup />
              {shownExceptions.length > 0 && (
                <section className="mt-6">
                  <h2 className="mb-1 text-lg font-semibold">Needs Review — no dollar amount yet</h2>
                  <p className="mb-2 text-sm text-muted-foreground">Not counted in any total until the package or billing info is filled in.</p>
                  <div className="space-y-2">
                    {shownExceptions.map((e) => (
                      <Card key={`${e.client_id}-${e.kind}`}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div><Link to="/clients/$id" params={{ id: e.client_id }} className="font-medium hover:underline">{e.name}</Link>
                          <p className="text-sm text-muted-foreground">{e.reason}</p></div>
                        <Button asChild size="sm" variant="outline"><Link to="/clients/$id" params={{ id: e.client_id }}>Open profile</Link></Button>
                      </CardContent></Card>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          <p className="mt-6 text-xs text-muted-foreground">Computed {new Date(q.data!.computed_at).toLocaleString()}</p>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, hint, t, tone, onClick }: { label: string; hint: string; t: { dollars: number; clients: number }; tone?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="h-full transition-colors hover:border-primary"><CardContent className="p-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold ${tone ?? ""}`}>{$(t.dollars)}</p>
        <p className="text-xs text-muted-foreground">{t.clients} client{t.clients === 1 ? "" : "s"} · {hint}</p>
      </CardContent></Card>
    </button>
  );
}

function WeekTab({ items, weekStart, empty }: { items: CollectionItem[]; weekStart: string; empty?: string }) {
  if (!items.length) return empty === "" ? null : <p className="text-muted-foreground">{empty ?? "No one scheduled this week owes anything."}</p>;
  return (
    <>
      {[0, 1, 2, 3, 4].map((d) => {
        const ymd = addDaysYmd(weekStart, d);
        const day = items.filter((i) => i.ymd === ymd);
        if (!day.length) return null;
        return (
          <section key={ymd} className="mb-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{md(ymd)} · {$(day.reduce((s, i) => s + i.amount, 0))}</h2>
            <ClientList items={day} empty="" />
          </section>
        );
      })}
    </>
  );
}

const URGENCY: CollectionGroup[] = ["pastDue", "thisWeek", "nextWeek", "review", "upcoming"];
const STATUS_TEXT: Record<CollectionGroup, string> = { pastDue: "Due now", thisWeek: "Due this week", nextWeek: "Due next week", review: "Needs review", upcoming: "Not due yet" };

/** Plain staff-facing label for what the money is for. Display only. */
function whatFor(i: CollectionItem): string {
  switch (i.kind) {
    case "current": return "Current package";
    case "previous": return "Past balance (earlier package)";
    case "renewal": return i.group === "upcoming" || i.group === "review" || i.group === "nextWeek" ? "Next package (not started)" : "New package (started)";
    case "ppv": return "Per-visit charges";
    case "weekly": return "Weekly billing";
    default: return i.label;
  }
}

function ClientList({ items, empty }: { items: CollectionItem[]; empty: string; showGroup?: boolean }) {
  const groups = byClient(items);
  if (!groups.length) return empty ? <p className="text-muted-foreground">{empty}</p> : null;
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const status = URGENCY.find((u) => g.items.some((i) => i.group === u)) ?? "upcoming";
        const lead = g.items.find((i) => i.group === status) ?? g.items[0];
        return (
          <Card key={g.client_id}><CardContent className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to="/clients/$id" params={{ id: g.client_id }} className="text-base font-semibold hover:underline">{g.name}</Link>
                <div className="mt-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${GROUP_TONE[status]}`}>{STATUS_TEXT[status]}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{status === "upcoming" || status === "nextWeek" ? "Will owe" : "Owes"}</p>
                <p className="text-2xl font-bold leading-tight">{$(g.amount)}</p>
              </div>
            </div>
            <p className="mt-2 text-sm"><span className="font-medium">Next step:</span> {lead.action}{lead.ymd ? ` · ${md(lead.ymd)}` : ""}{lead.time_iso ? ` ${time(lead.time_iso)}` : ""}</p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer py-1 text-muted-foreground">Details ({g.items.length})</summary>
              <ul className="mt-1 space-y-1.5 border-l pl-3">
                {g.items.map((i, k) => (
                  <li key={k} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0">
                      <span className="font-medium">{whatFor(i)}</span>
                      <span className="text-muted-foreground"> · {STATUS_TEXT[i.group]} · {i.reason}{i.ymd ? ` · ${md(i.ymd)}` : ""}</span>
                    </span>
                    <span className="text-muted-foreground">{$(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="sm" variant="outline" className="mt-2"><Link to="/clients/$id" params={{ id: g.client_id }}>Open profile</Link></Button>
            </details>
          </CardContent></Card>
        );
      })}
    </div>
  );
}
