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
  retryAllMatchedBlockedPayments,
  retryApplyPayment,
  searchClientsForPayment,
  suggestPaymentMatches,
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

function usePendingApprovedPayments() {
  return useQuery({
    queryKey: ["square_payments_pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("square_payments")
        .select(
          "id, square_payment_id, square_customer_id, client_id, amount_cents, currency, status, applied, needs_review, buyer_email, note, created_at, clients(first_name, last_name)",
        )
        .eq("applied", false)
        .eq("needs_review", false)
        .not("client_id", "is", null)
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
  const pending = usePendingApprovedPayments();

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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Needs Review — Square Payments</CardTitle>
                <CardDescription>
                  Payments we couldn’t confidently match to a client, or that arrived in a non-completed
                  state. Use Add/Edit Client to record manually if needed.
                </CardDescription>
              </div>
              <RetryAllButton />
            </div>
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
                    <TableHead>Client</TableHead>
                    <TableHead>Square Payment ID</TableHead>
                    <TableHead>Square Customer ID</TableHead>
                    <TableHead>Buyer Email</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Resolve</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(review.data ?? []).map((p) => {
                    const clientName = p.clients
                      ? `${p.clients.first_name} ${p.clients.last_name}`.trim()
                      : null;
                    const matchedButBlocked =
                      p.client_id && !p.applied && (p.status ?? "").toUpperCase() === "COMPLETED";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">
                          {formatDateTimeLocal(p.created_at)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatCurrency(p.amount_cents / 100)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.status ?? "—"}
                          {matchedButBlocked ? (
                            <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                              Matched but not applied — credit blocked (check package price / balance)
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.client_id ? (
                            <Link
                              to="/clients/$id"
                              params={{ id: p.client_id }}
                              className="text-slate-900 underline-offset-2 hover:underline"
                            >
                              {clientName || "View client"}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
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
                          {!p.square_customer_id ? (
                            <ResolvePaymentDialog payment={p} />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending / Approved Payments</CardTitle>
            <CardDescription>
              Matched to a client but not yet credited — waiting for the COMPLETED payment update
              from Square. These do not require action.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pending.isLoading ? (
              <div className="text-sm text-slate-500">Loading…</div>
            ) : pending.error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                Failed to load: {(pending.error as Error).message}
              </div>
            ) : (pending.data ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                No pending payments.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Square Payment ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pending.data ?? []).map((p) => {
                    const clientName = p.clients
                      ? `${p.clients.first_name} ${p.clients.last_name}`.trim()
                      : null;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap text-xs text-slate-600">
                          {formatDateTimeLocal(p.created_at)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatCurrency(p.amount_cents / 100)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.status ?? "—"}
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            Waiting for completed payment update
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.client_id ? (
                            <Link
                              to="/clients/$id"
                              params={{ id: p.client_id }}
                              className="text-slate-900 underline-offset-2 hover:underline"
                            >
                              {clientName || "View client"}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {p.square_payment_id}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

type SearchClient = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  status: string;
};

function ResolvePaymentDialog({ payment }: { payment: PaymentRow }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const queryClient = useQueryClient();
  const searchFn = useServerFn(searchClientsForPayment);
  const linkFn = useServerFn(resolvePaymentLink);
  const createFn = useServerFn(resolvePaymentCreateClient);
  const suggestFn = useServerFn(suggestPaymentMatches);

  const suggestQuery = useQuery({
    queryKey: ["payment_match_suggestions", payment.id],
    queryFn: () => suggestFn({ data: { payment_row_id: payment.id } }),
    enabled: open,
    staleTime: 60_000,
  });

  const searchMut = useMutation({
    mutationFn: async (q: string) => searchFn({ data: { query: q } }),
    onSuccess: (r) => setResults(r.clients as SearchClient[]),
    onError: (e) => toast.error(`Search failed: ${(e as Error).message}`),
  });

  const linkMut = useMutation({
    mutationFn: async (clientId: string) =>
      linkFn({ data: { payment_row_id: payment.id, client_id: clientId } }),
    onSuccess: (r) => {
      toast.success(
        r.already_applied
          ? "Linked — payment was already credited to this client."
          : `Applied $${(payment.amount_cents / 100).toFixed(2)} to client.`,
      );
      queryClient.invalidateQueries({ queryKey: ["square_payments_needs_review"] });
      setOpen(false);
    },
    onError: (e) => toast.error(`Link failed: ${(e as Error).message}`),
  });

  const createMut = useMutation({
    mutationFn: async () =>
      createFn({
        data: {
          payment_row_id: payment.id,
          first_name: firstName,
          last_name: lastName,
          email: payment.buyer_email,
          phone: phone || null,
        },
      }),
    onSuccess: () => {
      toast.success("Client created and payment applied.");
      queryClient.invalidateQueries({ queryKey: ["square_payments_needs_review"] });
      setOpen(false);
    },
    onError: (e) => toast.error(`Create failed: ${(e as Error).message}`),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve Square Payment</DialogTitle>
          <DialogDescription>
            Link this payment to an Admin client, or create a new client from the buyer email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="font-medium">{formatCurrency(payment.amount_cents / 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Buyer email</span>
              <span className="font-mono text-xs">{payment.buyer_email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payment date</span>
              <span className="text-xs">{formatDateTimeLocal(payment.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Square payment ID</span>
              <span className="font-mono text-xs">{payment.square_payment_id}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Suggested matches</Label>
              {suggestQuery.isFetching && (
                <span className="text-xs text-slate-400">Loading…</span>
              )}
            </div>
            {suggestQuery.data?.note && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                {suggestQuery.data.note}
              </div>
            )}
            {suggestQuery.error ? (
              <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                Failed to load suggestions: {(suggestQuery.error as Error).message}
              </div>
            ) : suggestQuery.data && suggestQuery.data.suggestions.length === 0 ? (
              <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
                No automatic suggestions. Search below.
              </div>
            ) : (
              <div className="space-y-2">
                {suggestQuery.data?.suggestions.map((s) => (
                  <div
                    key={s.client_id}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">
                            {s.first_name} {s.last_name}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                            {s.status}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              s.score >= 100
                                ? "bg-emerald-100 text-emerald-800"
                                : s.score >= 60
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            score {s.score} · {s.confidence} signal
                            {s.confidence === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {s.email ?? "no email"} · {s.phone ?? "no phone"} · Owes{" "}
                          {formatCurrency(s.amount_owed)}
                        </div>
                        <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-slate-700">
                          {s.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <Button
                        size="sm"
                        disabled={linkMut.isPending}
                        onClick={() => linkMut.mutate(s.client_id)}
                      >
                        Link
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Search Admin Clients</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Name, email, or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchMut.mutate(query);
                  }
                }}
              />
              <Button
                variant="secondary"
                disabled={searchMut.isPending || !query.trim()}
                onClick={() => searchMut.mutate(query)}
              >
                Search
              </Button>
            </div>
            {results.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200">
                {results.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-start gap-2 border-b border-slate-100 p-2 text-sm last:border-0 hover:bg-slate-50 ${
                      selectedId === c.id ? "bg-slate-100" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="client"
                      className="mt-1"
                      checked={selectedId === c.id}
                      onChange={() => setSelectedId(c.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">
                        {c.first_name} {c.last_name}{" "}
                        <span className="text-xs text-slate-400">({c.status})</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.email ?? "no email"} · {c.phone ?? "no phone"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <Button
              className="w-full"
              disabled={!selectedId || linkMut.isPending}
              onClick={() => selectedId && linkMut.mutate(selectedId)}
            >
              Link Payment to Selected Client
            </Button>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label>Or create new Admin client</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <Input
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <p className="text-xs text-slate-500">
              Email will be set to <span className="font-mono">{payment.buyer_email}</span>.
            </p>
            <Button
              variant="outline"
              className="w-full"
              disabled={createMut.isPending || (!firstName.trim() && !lastName.trim())}
              onClick={() => createMut.mutate()}
            >
              Create New Client from Buyer Email
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
