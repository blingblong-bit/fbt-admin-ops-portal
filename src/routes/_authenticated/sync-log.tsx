import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTimeLocal } from "@/lib/clients";

export const Route = createFileRoute("/_authenticated/sync-log")({
  head: () => ({
    meta: [{ title: "Square Sync Log — FIT Beyond Therapy" }],
  }),
  component: SyncLogPage,
});

type LogRow = {
  id: string;
  event_type: string;
  square_customer_id: string | null;
  client_id: string | null;
  status: "success" | "skipped" | "error";
  action: string | null;
  message: string | null;
  created_at: string;
};

type LogWithClient = LogRow & {
  clients: { first_name: string; last_name: string } | null;
};

function badgeClasses(status: LogRow["status"]) {
  switch (status) {
    case "success":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "skipped":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "error":
      return "bg-red-100 text-red-800 border-red-200";
  }
}

function SyncLogPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["square_sync_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("square_sync_log")
        .select("id, event_type, square_customer_id, client_id, status, action, message, created_at, clients(first_name, last_name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as LogWithClient[];
    },
    refetchInterval: 10_000,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Square Sync Log</h1>
          <p className="text-slate-600">
            Read-only record of every customer event received from Square. Newest first. Refreshes
            automatically every 10 seconds.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
            <CardDescription>
              Showing the most recent 200 events. Statuses:{" "}
              <span className="font-medium text-emerald-700">success</span>,{" "}
              <span className="font-medium text-slate-700">skipped</span>,{" "}
              <span className="font-medium text-red-700">error</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Failed to load sync log: {(error as Error).message}
              </div>
            ) : isLoading ? (
              <div className="text-sm text-slate-500">Loading…</div>
            ) : !data || data.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No Square events yet. Create a test customer in your Square sandbox to see it
                appear here.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Square Customer ID</TableHead>
                    <TableHead>Matched Client</TableHead>
                    <TableHead>Action / Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => {
                    const clientName = row.clients
                      ? `${row.clients.first_name} ${row.clients.last_name}`.trim()
                      : null;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">
                          {formatDateTimeLocal(row.created_at)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{row.event_type}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClasses(row.status)}`}
                          >
                            {row.status}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {row.square_customer_id ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.client_id ? (
                            <Link
                              to="/clients/$id"
                              params={{ id: row.client_id }}
                              className="text-slate-900 underline-offset-2 hover:underline"
                            >
                              {clientName || "View client"}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {row.action ? (
                            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                              {row.action}
                            </span>
                          ) : null}
                          {row.message ?? ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
