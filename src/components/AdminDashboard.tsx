import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Wallet, RefreshCw, UserPlus } from "lucide-react";
import { formatCurrency } from "@/lib/clients";
import { computeCollections } from "@/lib/collections";
import { groupRenewals } from "@/lib/renewals-view";
import { collectionWeekStart } from "@/lib/work-week";
import type { RenewalForecastRow } from "@/lib/schedule.functions";

type MasterData = Parameters<typeof computeCollections> extends [infer R, infer A, infer E, string]
  ? { rows: R; appointments: A; exceptions: E }
  : never;

/**
 * Admin dashboard: three primary areas. Numbers come from the same
 * functions the destination pages use (computeCollections / groupRenewals)
 * so the dashboard can never show a different total than the page.
 */
export function AdminPrimaryAreas({
  masterData,
  renewalRows,
  newClientsCount,
  newClientsLabel,
  newClientsActive,
  onNewClients,
}: {
  masterData: MasterData | null;
  renewalRows: RenewalForecastRow[];
  newClientsCount: number;
  newClientsLabel: string;
  newClientsActive: boolean;
  onNewClients: () => void;
}) {
  const col = useMemo(() => {
    if (!masterData) return null;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    return computeCollections(masterData.rows, masterData.appointments, masterData.exceptions, collectionWeekStart());
  }, [masterData]);
  const ren = useMemo(() => groupRenewals(renewalRows), [renewalRows]);
  const money = (n: number | undefined) => (n === undefined ? "…" : formatCurrency(n));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Link to="/collections" className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary">
        <div className="flex items-center gap-2 font-semibold"><Wallet className="h-5 w-5" /> Collections</div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Stat label="This Week" value={money(col?.totals.thisWeekAll.dollars)} />
          <Stat label="Due Now (part of This Week)" value={money(col?.totals.pastDue.dollars)} />
          <Stat label="Next Week" value={money(col?.totals.nextWeek.dollars)} />
          <Stat label="Master total" value={money(col?.totals.masterTotal)} />
        </dl>
      </Link>
      <Link to="/renewals" className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary">
        <div className="flex items-center gap-2 font-semibold"><RefreshCw className="h-5 w-5" /> Renewals</div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Stat label="Needs Renewal" value={String(ren.needs.length)} />
          <Stat label="Scheduled" value={String(ren.scheduled.length)} />
          <Stat label="Needs Attention" value={String(ren.attention.length)} />
        </dl>
      </Link>
      <button
        type="button"
        onClick={onNewClients}
        className={`rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary ${newClientsActive ? "border-primary" : ""}`}
      >
        <div className="flex items-center gap-2 font-semibold"><UserPlus className="h-5 w-5" /> New Clients</div>
        <div className="mt-3 text-2xl font-semibold">{newClientsCount}</div>
        <div className="text-xs text-muted-foreground">{newClientsLabel} · tap to {newClientsActive ? "hide" : "see"} list</div>
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

const TOOL_LINKS = [
  ["/payment-due", "Payment Due ledger"],
  ["/weekly-dues", "Weekly Dues"],
  ["/payment-history", "Payment History"],
  ["/missed-check-ins", "Missed Check-ins"],
  ["/renewal-review", "Renewal Review"],
  ["/schedule-check", "Schedule Check"],
  ["/dues-texts", "Dues Texts"],
  ["/dues-queue", "Send Dues Message"],
  ["/messaging-preview", "Messaging Preview"],
  ["/visit-note-review", "Visit Note Review"],
  ["/visit-automation-review", "Visit Automation"],
  ["/merge-center", "Merge Center"],
  ["/notes-ledger", "Notes Ledger"],
  ["/import", "Import"],
  ["/backup", "Backup"],
  ["/sync-log", "Sync Log"],
  ["/square-diagnostic", "Square Diagnostic"],
  ["/clients/deleted", "Deleted Clients"],
] as const;

export function AdminToolLinks() {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {TOOL_LINKS.map(([to, label]) => (
        <Link key={to} to={to} className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary">
          {label}
        </Link>
      ))}
    </div>
  );
}
