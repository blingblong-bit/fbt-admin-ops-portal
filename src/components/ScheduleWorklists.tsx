import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/clients";
import { invalidateFor } from "@/lib/invalidation";
import {
  hideScheduleClient,
  restoreScheduleClient,
  type ScheduleCheckResult,
  type WorklistRow,
} from "@/lib/schedule.functions";

type Key = "package_completed" | "not_scheduled" | "only_once" | "hidden";
const TABS: { key: Key; label: string; help: string }[] = [
  { key: "package_completed", label: "Package Completed", help: "Package used up recently — reschedule or review renewal." },
  { key: "not_scheduled", label: "Not Scheduled", help: "No future Square booking; seen in the last 60 days or has a new package." },
  { key: "only_once", label: "Only Once This Week", help: "Exactly one appointment in this work week." },
  { key: "hidden", label: "Hidden", help: "Not seen in 60+ days, or hidden by staff. New bookings or packages bring them back." },
];

const fmt = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : "—");

export function ScheduleWorklists({ data, filter }: { data: ScheduleCheckResult["worklists"] | undefined; filter: string }) {
  const [tab, setTab] = useState<Key>("not_scheduled");
  const [q, setQ] = useState("");
  const term = (q || filter).trim().toLowerCase();
  const rows = useMemo(() => {
    const list = data?.[tab] ?? [];
    if (!term) return tab === "hidden" ? list.filter((r) => r.hidden_kind === "manual") : list;
    return list.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(term));
  }, [data, tab, term]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduling Worklists</CardTitle>
        <CardDescription>Each client appears in one list only. Read from Square; nothing is changed in Square.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{data.error}</div>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Key)}>
          <TabsList className="flex h-auto flex-wrap justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="min-h-10">
                {t.label} ({data?.[t.key].length ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="space-y-2">
              <p className="text-xs text-muted-foreground">{t.help}</p>
              {t.key === "hidden" && (
                <>
                  <Input placeholder="Search hidden clients…" value={q} onChange={(e) => setQ(e.target.value)} className="h-11" />
                  {!term && <p className="text-xs text-muted-foreground">Showing staff-hidden clients. Search to find auto-hidden ones.</p>}
                </>
              )}
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{term ? "No matching clients." : "Nothing here."}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {rows.slice(0, 300).map((r) => <Row key={r.id} r={r} tab={t.key} />)}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Row({ r, tab }: { r: WorklistRow; tab: Key }) {
  const qc = useQueryClient();
  const hideFn = useServerFn(hideScheduleClient);
  const restoreFn = useServerFn(restoreScheduleClient);
  const hide = useMutation({
    mutationFn: (reason: string) => hideFn({ data: { clientId: r.id, reason } }),
    onSuccess: () => { toast.success("Hidden from worklists"); invalidateFor(qc, "schedule-hide-changed", { clientId: r.id }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const restore = useMutation({
    mutationFn: () => restoreFn({ data: { clientId: r.id } }),
    onSuccess: () => { toast.success("Restored"); invalidateFor(qc, "schedule-hide-changed", { clientId: r.id }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <li className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium">
          {r.first_name} {r.last_name}
          {r.hidden_kind && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {r.hidden_kind === "manual" ? "Hidden by staff" : "Auto-hidden"}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {r.phone ?? "No phone"} · {r.remaining_left ?? "—"} visits left · Last visit {fmt(r.last_kept_visit)}
          {r.next_appointment_at && <> · Next {fmt(r.next_appointment_at)}</>}
        </div>
        {r.reasons.map((x) => (
          <div key={x} className="text-xs text-amber-700">{x}</div>
        ))}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild size="sm" variant="outline" className="h-10 md:h-8">
          <Link to="/clients/$id" params={{ id: r.id }}>View</Link>
        </Button>
        {tab === "hidden" && r.hidden_kind === "manual" ? (
          <Button size="sm" variant="outline" className="h-10 md:h-8" disabled={restore.isPending} onClick={() => restore.mutate()}>
            Restore
          </Button>
        ) : tab !== "hidden" ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 md:h-8"
            disabled={hide.isPending}
            onClick={() => {
              const reason = window.prompt(`Hide ${r.first_name} ${r.last_name} from worklists? Optional reason:`);
              if (reason !== null) hide.mutate(reason);
            }}
          >
            Hide
          </Button>
        ) : null}
      </div>
    </li>
  );
}
