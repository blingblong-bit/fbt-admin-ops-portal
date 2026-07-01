import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatDateTimeLocal } from "@/lib/clients";
import {
  resolvePaymentCreateClient,
  resolvePaymentLink,
  searchClientsForPayment,
} from "@/lib/payments.functions";

export const Route = createFileRoute("/_authenticated/sync-log")({
  head: () => ({
    meta: [{ title: "Square Sync — FIT Beyond Therapy" }],
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

type PaymentRow = {
  id: string;
  square_payment_id: string;
  square_customer_id: string | null;
  client_id: string | null;
  amount_cents: number;
  currency: string;
  status: string | null;
  applied: boolean;
  needs_review: boolean;
  buyer_email: string | null;
  note: string | null;
  created_at: string;
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

function useLogs(filterEventLike: string | null) {
  return useQuery({
    queryKey: ["square_sync_log", filterEventLike ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("square_sync_log")
        .select(
          "id, event_type, square_customer_id, client_id, status, action, message, created_at, clients(first_name, last_name)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (filterEventLike) q = q.like("event_type", filterEventLike);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LogWithClient[];
    },
    refetchInterval: 10_000,
  });
}

function usePaymentsNeedingReview() {
  return useQuery({
    queryKey: ["square_payments_needs_review"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("square_payments")
        .select(
          "id, square_payment_id, square_customer_id, client_id, amount_cents, currency, status, applied, needs_review, buyer_email, note, created_at, clients(first_name, last_name)",
        )
        .eq("needs_review", true)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as PaymentRow[];
    },
    refetchInterval: 10_000,
  });
}

function LogsTable({ rows }: { rows: LogWithClient[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        No events yet.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Square ID</TableHead>
          <TableHead>Matched Client</TableHead>
          <TableHead>Action / Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
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
  );
}

function SyncLogPage() {
  const all = useLogs(null);
  const customers = useLogs("customer.%");
  const payments = useLogs("payment.%");
  const review = usePaymentsNeedingReview();

  const renderState = (q: ReturnType<typeof useLogs>) => {
    if (q.error)
      return (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load: {(q.error as Error).message}
        </div>
      );
    if (q.isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
    return <LogsTable rows={q.data ?? []} />;
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Square Sync</h1>
          <p className="text-slate-600">
            Read-only view of Square activity. Refreshes every 10 seconds.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Needs Review — Square Payments</CardTitle>
            <CardDescription>
              Payments we couldn’t confidently match to a client, or that arrived in a non-completed
              state. Use Add/Edit Client to record manually if needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {review.isLoading ? (
              <div className="text-sm text-slate-500">Loading…</div>
            ) : review.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Failed to load: {(review.error as Error).message}
              </div>
            ) : (review.data ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Nothing to review. All recent Square payments matched a client.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Square Payment ID</TableHead>
                    <TableHead>Square Customer ID</TableHead>
                    <TableHead>Buyer Email</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Resolve</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(review.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-600">
                        {formatDateTimeLocal(p.created_at)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {formatCurrency(p.amount_cents / 100)}
                      </TableCell>
                      <TableCell className="text-xs">{p.status ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {p.square_payment_id}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {p.square_customer_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {p.buyer_email ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{p.note ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {!p.square_customer_id && p.buyer_email ? (
                          <ResolvePaymentDialog payment={p} />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
            <CardDescription>
              Most recent 200 per tab.{" "}
              <span className="font-medium text-emerald-700">success</span>,{" "}
              <span className="font-medium text-slate-700">skipped</span>,{" "}
              <span className="font-medium text-red-700">error</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
                <TabsTrigger value="customers">Customers</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-4">
                {renderState(all)}
              </TabsContent>
              <TabsContent value="payments" className="mt-4">
                {renderState(payments)}
              </TabsContent>
              <TabsContent value="customers" className="mt-4">
                {renderState(customers)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
