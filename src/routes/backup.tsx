import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  amountOwed,
  formatDate,
  formatDateTimeLocal,
  fullName,
  visitsRemaining,
  type Client,
} from "@/lib/clients";

export const Route = createFileRoute("/backup")({
  head: () => ({
    meta: [{ title: "Backup & Data Management — FIT Beyond Therapy" }],
  }),
  component: BackupPage,
});

type Stats = {
  active: number;
  archived: number;
};

function BackupPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastExportAt, setLastExportAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("fbt:lastExportAt");
  });

  async function loadStats() {
    const [{ count: active }, { count: archived }] = await Promise.all([
      supabase.from("clients").select("*", { count: "exact", head: true }).is("deleted_at", null),
      supabase.from("clients").select("*", { count: "exact", head: true }).not("deleted_at", "is", null),
    ]);
    setStats({ active: active ?? 0, archived: archived ?? 0 });
  }

  useEffect(() => {
    loadStats();
  }, []);

  async function fetchAllClients(): Promise<Client[]> {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("last_name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Client[];
  }

  function downloadBlob(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const ts = new Date().toISOString();
    window.localStorage.setItem("fbt:lastExportAt", ts);
    setLastExportAt(ts);
  }

  function timestamp() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function clientRows(clients: Client[]) {
    return clients.map((c) => {
      const remaining = visitsRemaining(c);
      return {
        id: c.id,
        name: fullName(c),
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone ?? "",
        email: c.email ?? "",
        package_name: c.package_name ?? "",
        package_price: Number(c.package_price ?? 0),
        amount_paid: Number(c.amount_paid ?? 0),
        amount_owed: amountOwed(c),
        package_total_visits: c.package_total_visits,
        visits_used: c.visits_used ?? "",
        visits_remaining: remaining ?? "",
        square_visit_note: c.square_visit_note ?? "",
        is_scheduled: c.is_scheduled ? "Yes" : "No",
        package_start_date: c.package_start_date ?? "",
        internal_notes: c.internal_notes ?? "",
        deleted_at: c.deleted_at ?? "",
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
    });
  }

  async function exportCsv() {
    setLoading(true);
    try {
      const clients = await fetchAllClients();
      const rows = clientRows(clients);
      const headers = Object.keys(
        rows[0] ?? {
          id: "",
          name: "",
          first_name: "",
          last_name: "",
          phone: "",
          email: "",
          package_name: "",
          package_price: "",
          amount_paid: "",
          amount_owed: "",
          package_total_visits: "",
          visits_used: "",
          visits_remaining: "",
          square_visit_note: "",
          is_scheduled: "",
          package_start_date: "",
          internal_notes: "",
          deleted_at: "",
          created_at: "",
          updated_at: "",
        },
      );
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(",")),
      ].join("\n");
      downloadBlob(csv, `fbt-clients-${timestamp()}.csv`, "text/csv;charset=utf-8");
    } finally {
      setLoading(false);
    }
  }

  async function exportJson() {
    setLoading(true);
    try {
      const clients = await fetchAllClients();
      const payload = {
        exported_at: new Date().toISOString(),
        count: clients.length,
        clients: clientRows(clients),
      };
      downloadBlob(JSON.stringify(payload, null, 2), `fbt-clients-${timestamp()}.json`, "application/json");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Backup & Data Management</h1>
          <p className="text-slate-600">
            Protect your business data. Export client records and review backup status.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Database Status</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Active Clients" value={stats ? String(stats.active) : "…"} />
            <StatCard label="Total Archived Clients" value={stats ? String(stats.archived) : "…"} />
            <StatCard label="Last Backup Date" value="Not Configured" muted />
            <StatCard
              label="Last Manual Backup"
              value={lastExportAt ? formatDate(lastExportAt) : "Never"}
              muted={!lastExportAt}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Export Clients</h2>
          <Card>
            <CardHeader>
              <CardTitle>Download a full client export</CardTitle>
              <CardDescription>
                Includes name, contact info, package details, payments, visits, scheduling status,
                notes, and timestamps for every client (including archived).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li>
                  <strong>Export CSV</strong> for spreadsheet review and easy sharing.
                </li>
                <li>
                  <strong>Export JSON</strong> for a complete data backup with all fields intact.
                </li>
                <li>
                  Store both files in <strong>Google Drive</strong> weekly for safekeeping.
                </li>
              </ol>
              <div className="flex flex-wrap gap-3">
                <Button onClick={exportCsv} disabled={loading}>
                  {loading ? "Preparing…" : "Export All Clients (CSV)"}
                </Button>
                <Button variant="outline" onClick={exportJson} disabled={loading}>
                  {loading ? "Preparing…" : "Export All Clients (JSON)"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Reminder</h2>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-slate-700">
                Recommended: export CSV and JSON once per week before making major edits.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Backup Status</h2>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Automatic Backup</CardTitle>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Not Configured
                </span>
              </div>
              <CardDescription>
                This application will eventually support automatic cloud backups on a regular
                schedule. Until then, use the export tools above to keep a local copy of your data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled variant="outline">Configure Automatic Backups</Button>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Restore</h2>
          <Card>
            <CardHeader>
              <CardTitle>Restore Database</CardTitle>
              <CardDescription>
                Restore data from a previously exported backup. This feature is coming soon and is
                not yet available.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled variant="outline">Restore From Backup</Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div
          className={`mt-2 text-2xl font-semibold tracking-tight ${
            muted ? "text-slate-500" : "text-slate-900"
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
