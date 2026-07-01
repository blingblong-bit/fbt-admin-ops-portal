import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate, formatDateTimeLocal } from "@/lib/clients";
import {
  completeVisitForClient,
  getScheduleCheck,
  linkSquareCustomer,
  listLinkableClients,
  type LinkableClient,
  type NeedsScheduleClient,
  type ScheduleAppointment,
} from "@/lib/schedule.functions";
import {
  backfillProductionCustomers,
  createClientFromSquareReview,
  ignoreSquareReview,
  linkSquareReview,
  listSquareCustomerReviews,
  type SquareCustomerReview,
} from "@/lib/backfill.functions";

export const Route = createFileRoute("/_authenticated/schedule-check")({
  head: () => ({ meta: [{ title: "Schedule Check — FIT Beyond Therapy" }] }),
  component: ScheduleCheckPage,
});

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function visitsRemaining(c: { package_total_visits: number; visits_used: number | null }) {
  if (c.visits_used === null || c.visits_used === undefined) return c.package_total_visits;
  return Math.max(0, c.package_total_visits - c.visits_used);
}

function ScheduleCheckPage() {
  const [date, setDate] = useState<string>(todayYmd());
  const fetchSchedule = useServerFn(getScheduleCheck);
  const completeVisit = useServerFn(completeVisitForClient);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["schedule-check", date],
    queryFn: () => fetchSchedule({ data: { date } }),
  });

  const completeMut = useMutation({
    mutationFn: (clientId: string) => completeVisit({ data: { clientId } }),
    onSuccess: () => {
      toast.success("Visit recorded");
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runBackfill = useServerFn(backfillProductionCustomers);
  const backfillMut = useMutation({
    mutationFn: () => runBackfill({}),
    onSuccess: (r) => {
      toast.success(
        `Backfill: ${r.auto_linked} auto-linked · ${r.queued_for_review} need review · ${r.hidden_old} hidden (old) · ${r.updated_contact} contact updates · ${r.errors.length} errors`,
      );
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["square-reviews"] });
    },
    onError: (e: Error) => toast.error(`Backfill failed: ${e.message}`),
  });

  const data = query.data;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Production Read-Only
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Schedule Check</h1>
          <p className="text-slate-600">
            Read-only view of Square appointments from the <strong>Production</strong> Square
            account. Therapy Admin never writes back to Square. Bookings whose customer ID
            isn't linked to an Admin client appear under "Unmatched Appointments".
          </p>
          <div className="pt-2">
            <Button
              variant="outline"
              onClick={() => backfillMut.mutate()}
              disabled={backfillMut.isPending}
            >
              {backfillMut.isPending ? "Running backfill…" : "Backfill Square Customers"}
            </Button>
            <p className="mt-1 text-xs text-slate-500">
              Pulls all Production Square customers. Auto-links to Admin clients only on a
              high-confidence email/phone match. Uncertain matches are sent to <em>Needs Review</em>{" "}
              below.
            </p>
          </div>
        </header>

        <SquareReviewCard />


        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <CardTitle>Selected Date</CardTitle>
                <CardDescription>
                  Week of {data ? `${formatDate(data.week_start)} – ${formatDate(data.week_end)}` : "—"}
                  {data && (
                    <>
                      {" "}· Next week {formatDate(data.next_week_start)} – {formatDate(data.next_week_end)}
                    </>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value || todayYmd())}
                    className="w-44"
                  />
                </div>
                <Button variant="outline" onClick={() => setDate(todayYmd())}>
                  Today
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            {query.isLoading && <div>Loading…</div>}
            {query.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
                Failed to load: {(query.error as Error).message}
              </div>
            )}
            {data?.error && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Square API: {data.error}
              </div>
            )}
            {data && (
              <div>
                Fetched {data.fetched_count} bookings · {data.unmatched.length} unmatched
              </div>
            )}
          </CardContent>
        </Card>

        <AppointmentsCard
          title="Scheduled on Selected Date"
          description={data ? formatDate(data.selected_date) : ""}
          appointments={data?.selected_day ?? []}
          showCompleteVisit
          onCompleteVisit={(clientId) => completeMut.mutate(clientId)}
          completing={completeMut.isPending ? completeMut.variables ?? null : null}
        />

        <AppointmentsCard
          title="Scheduled This Week"
          description={data ? `${formatDate(data.week_start)} – ${formatDate(data.week_end)}` : ""}
          appointments={data?.this_week ?? []}
        />

        <AppointmentsCard
          title="Scheduled Next Week"
          description={
            data ? `${formatDate(data.next_week_start)} – ${formatDate(data.next_week_end)}` : ""
          }
          appointments={data?.next_week ?? []}
        />

        <ClientsNeedingCard
          title="Needs Next Week Scheduling"
          description="Active clients with appointments this week but none next week."
          clients={data?.needs_next_week_scheduling ?? []}
        />

        <ClientsNeedingCard
          title="Not Scheduled After Selected Date"
          description="Active clients with visits remaining and no Square appointment after this date."
          clients={data?.not_scheduled_after ?? []}
        />

        <UnmatchedAppointmentsCard appointments={data?.unmatched ?? []} />
      </div>
    </AppShell>
  );
}

function UnmatchedAppointmentsCard({ appointments }: { appointments: ScheduleAppointment[] }) {
  const listFn = useServerFn(listLinkableClients);
  const linkFn = useServerFn(linkSquareCustomer);
  const qc = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["linkable-clients"],
    queryFn: () => listFn(),
    enabled: appointments.length > 0,
  });

  const linkMut = useMutation({
    mutationFn: (vars: { clientId: string; squareCustomerId: string }) =>
      linkFn({ data: vars }),
    onSuccess: () => {
      toast.success("Square customer linked");
      qc.invalidateQueries({ queryKey: ["schedule-check"] });
      qc.invalidateQueries({ queryKey: ["linkable-clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Group appointments by Square customer ID so the same person isn't linked twice in a row.
  const grouped = useMemo(() => {
    const m = new Map<string, ScheduleAppointment[]>();
    for (const a of appointments) {
      const key = a.square_customer_id ?? `__no_id_${a.booking_id}`;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [appointments]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unmatched Appointments</CardTitle>
        <CardDescription>
          Production Square bookings whose customer ID isn't linked to an Admin client. Link them
          here so future appointments and payments match automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <EmptyState text="All bookings match an Admin client." />
        ) : (
          <div className="space-y-3">
            {grouped.map(([key, group]) => {
              const first = group[0];
              const info = first.customer_info;
              const fullName = [info?.given_name, info?.family_name].filter(Boolean).join(" ").trim();
              const anchorKey = first.square_customer_id ?? first.booking_id;
              const linkedElsewhere =
                first.square_customer_id && (clientsQuery.data ?? []).find(
                  (c) => c.square_customer_id === first.square_customer_id,
                );
              return (
                <div
                  key={key}
                  id={`unmatched-${anchorKey}`}
                  className="scroll-mt-24 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm transition-shadow"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-slate-900">
                        {fullName || <span className="text-slate-500">Unknown name</span>}
                      </div>
                      <div className="text-xs text-slate-600">
                        <span className="text-slate-400">Email: </span>
                        {info?.email ?? <span className="italic text-slate-400">none</span>}
                        {" · "}
                        <span className="text-slate-400">Phone: </span>
                        {info?.phone ?? <span className="italic text-slate-400">none</span>}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Square customer ID: {first.square_customer_id ?? "— (booking has no customer)"}
                      </div>
                      <div className="text-[11px]">
                        {!first.square_customer_id ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                            Square booking has no customer_id — can't be linked
                          </span>
                        ) : linkedElsewhere ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                            ⚠ Already linked to {linkedElsewhere.first_name}{" "}
                            {linkedElsewhere.last_name} — refresh Schedule Check
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                            No Admin client has this Square customer ID
                          </span>
                        )}
                      </div>
                    </div>
                    {first.square_customer_id && !linkedElsewhere && (
                      <LinkClientControl
                        clients={clientsQuery.data ?? []}
                        loading={clientsQuery.isLoading}
                        disabled={linkMut.isPending}
                        onLink={(clientId) =>
                          linkMut.mutate({
                            clientId,
                            squareCustomerId: first.square_customer_id!,
                          })
                        }
                      />
                    )}
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="py-1 pr-3 font-medium">When</th>
                          <th className="py-1 pr-3 font-medium">Service</th>
                          <th className="py-1 pr-3 font-medium">Status</th>
                          <th className="py-1 pr-3 font-medium">Booking ID</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700">
                        {group.map((g) => (
                          <tr key={g.booking_id} className="border-t border-slate-200">
                            <td className="py-1 pr-3 whitespace-nowrap">
                              {formatDateTimeLocal(g.start_at)}
                            </td>
                            <td className="py-1 pr-3">
                              {g.service_name ??
                                (g.duration_minutes ? `${g.duration_minutes} min` : "—")}
                            </td>
                            <td className="py-1 pr-3">{g.status}</td>
                            <td className="py-1 pr-3 font-mono text-[10px] text-slate-500">
                              {g.booking_id}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkClientControl({
  clients,
  loading,
  disabled,
  onLink,
}: {
  clients: LinkableClient[];
  loading: boolean;
  disabled: boolean;
  onLink: (clientId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients
      .filter((c) =>
        `${c.first_name} ${c.last_name} ${c.email ?? ""} ${c.phone ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50);
  }, [clients, query]);

  return (
    <div className="flex flex-col items-end gap-2">
      <Input
        placeholder="Search clients…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 w-56 text-xs"
      />
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={loading}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder={loading ? "Loading…" : "Select a client"} />
          </SelectTrigger>
          <SelectContent>
            {filtered.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.first_name} {c.last_name}
                {c.square_customer_id ? " (already linked)" : ""}
              </SelectItem>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-1 text-xs text-slate-500">No matches</div>
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!selected || disabled}
          onClick={() => selected && onLink(selected)}
        >
          Link
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function AppointmentsCard({
  title,
  description,
  appointments,
  showCompleteVisit = false,
  onCompleteVisit,
  completing,
}: {
  title: string;
  description: string;
  appointments: ScheduleAppointment[];
  showCompleteVisit?: boolean;
  onCompleteVisit?: (clientId: string) => void;
  completing?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <EmptyState text="No appointments." />
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((a) => {
                  const remaining = a.client ? visitsRemaining(a.client) : 0;
                  return (
                    <TableRow key={a.booking_id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTimeLocal(a.start_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.client ? (
                          <div>
                            <div className="font-medium whitespace-nowrap">
                              {a.client.first_name} {a.client.last_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {remaining} visits left
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const key = a.square_customer_id ?? a.booking_id;
                              const el = document.getElementById(`unmatched-${key}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "start" });
                                el.classList.add("ring-2", "ring-amber-400");
                                setTimeout(
                                  () => el.classList.remove("ring-2", "ring-amber-400"),
                                  1600,
                                );
                              }
                            }}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 underline-offset-2 hover:bg-amber-200 hover:underline"
                            title="Jump to Unmatched Appointments"
                          >
                            Unmatched ↓
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {a.service_name ?? (a.duration_minutes ? `${a.duration_minutes} min` : "—")}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{a.status}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {a.client ? (
                          <div className="inline-flex gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link to="/clients/$id" params={{ id: a.client.id }}>
                                View Client
                              </Link>
                            </Button>
                            {showCompleteVisit && remaining > 0 && onCompleteVisit && (
                              <Button
                                size="sm"
                                disabled={completing === a.client.id}
                                onClick={() => onCompleteVisit(a.client!.id)}
                              >
                                {completing === a.client.id ? "Recording…" : "Complete Visit"}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>

                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>

  );
}

function ClientsNeedingCard({
  title,
  description,
  clients,
}: {
  title: string;
  description: string;
  clients: NeedsScheduleClient[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {clients.length === 0 ? (
          <EmptyState text="Nothing to follow up on." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Visits Left</TableHead>
                <TableHead>Owed</TableHead>
                <TableHead>Last Appt</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => {
                const remaining = visitsRemaining(c);
                const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.first_name} {c.last_name}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{remaining}</TableCell>
                    <TableCell className="text-sm">{formatCurrency(owed)}</TableCell>
                    <TableCell className="text-sm">
                      {c.last_appointment_at ? formatDate(c.last_appointment_at.slice(0, 10)) : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-slate-600">
                      {c.internal_notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/clients/$id" params={{ id: c.id }}>
                          View Client
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SquareReviewCard() {
  const [filter, setFilter] = useState<"relevant" | "hidden" | "all">("relevant");
  const listFn = useServerFn(listSquareCustomerReviews);
  const linkClientsFn = useServerFn(listLinkableClients);
  const linkReviewFn = useServerFn(linkSquareReview);
  const createFn = useServerFn(createClientFromSquareReview);
  const ignoreFn = useServerFn(ignoreSquareReview);
  const qc = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: ["square-reviews", filter],
    queryFn: () => listFn({ data: { filter } }),
  });

  const clientsQuery = useQuery({
    queryKey: ["linkable-clients"],
    queryFn: () => linkClientsFn(),
    enabled: (reviewsQuery.data?.length ?? 0) > 0,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["square-reviews"] });
    qc.invalidateQueries({ queryKey: ["linkable-clients"] });
    qc.invalidateQueries({ queryKey: ["schedule-check"] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const linkMut = useMutation({
    mutationFn: (vars: { reviewId: string; clientId: string }) => linkReviewFn({ data: vars }),
    onSuccess: () => {
      toast.success("Linked to Square customer");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: (reviewId: string) => createFn({ data: { reviewId } }),
    onSuccess: () => {
      toast.success("New client created and linked");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ignoreMut = useMutation({
    mutationFn: (reviewId: string) => ignoreFn({ data: { reviewId } }),
    onSuccess: () => {
      toast.success("Ignored");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviews = reviewsQuery.data ?? [];

  const tabs: { key: typeof filter; label: string }[] = [
    { key: "relevant", label: "Needs Review (Scheduled · Recent · Possible Match)" },
    { key: "hidden", label: "Hidden Old Customers" },
    { key: "all", label: "Show All" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs Review ({reviews.length})</CardTitle>
        <CardDescription>
          Production Square customers that couldn't be auto-linked. Only customers with a future
          appointment, a payment in the last 60 days, or a possible email/phone match are shown by
          default. Old, unmatched Square records are hidden — they aren't deleted.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {tabs.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={filter === t.key ? "default" : "outline"}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {reviewsQuery.isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : reviews.length === 0 ? (
          <EmptyState text="Nothing waiting for review." />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <ReviewRow
                key={r.id}
                review={r}
                clients={clientsQuery.data ?? []}
                clientsLoading={clientsQuery.isLoading}
                busy={linkMut.isPending || createMut.isPending || ignoreMut.isPending}
                onLink={(clientId) => linkMut.mutate({ reviewId: r.id, clientId })}
                onCreate={() => createMut.mutate(r.id)}
                onIgnore={() => ignoreMut.mutate(r.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const RELEVANCE_LABELS: Record<string, { label: string; className: string }> = {
  scheduled_future: { label: "Scheduled", className: "bg-emerald-100 text-emerald-900" },
  recent_payment: { label: "Recent Payment", className: "bg-blue-100 text-blue-900" },
  possible_match: { label: "Possible Match", className: "bg-amber-100 text-amber-900" },
  hidden_old: { label: "Hidden (Old)", className: "bg-slate-200 text-slate-700" },
};

function ReviewRow({
  review,
  clients,
  clientsLoading,
  busy,
  onLink,
  onCreate,
  onIgnore,
}: {
  review: SquareCustomerReview;
  clients: LinkableClient[];
  clientsLoading: boolean;
  busy: boolean;
  onLink: (clientId: string) => void;
  onCreate: () => void;
  onIgnore: () => void;
}) {
  const fullName = [review.given_name, review.family_name].filter(Boolean).join(" ").trim();
  const suggested = review.suggested_client;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium text-slate-900">
            {fullName || <span className="text-slate-500">Unknown name</span>}
          </div>
          <div className="text-xs text-slate-600">
            {review.email && <span>{review.email}</span>}
            {review.email && review.phone && " · "}
            {review.phone && <span>{review.phone}</span>}
            {!review.email && !review.phone && <span className="italic">No email or phone</span>}
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            Square ID: {review.square_customer_id}
          </div>
          <div className="text-xs flex flex-wrap gap-1">
            {(() => {
              const rel = RELEVANCE_LABELS[review.relevance] ?? RELEVANCE_LABELS.possible_match;
              return (
                <span className={`rounded-full px-2 py-0.5 font-medium ${rel.className}`}>
                  {rel.label}
                </span>
              );
            })()}
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
              {review.reason}
            </span>
          </div>
          {suggested && (
            <div className="text-xs text-slate-700">
              Suggested match:{" "}
              <Link
                to="/clients/$id"
                params={{ id: suggested.id }}
                className="font-medium text-slate-900 underline"
              >
                {suggested.first_name} {suggested.last_name}
              </Link>
              {(suggested.email || suggested.phone) && (
                <span className="text-slate-500">
                  {" "}
                  · {suggested.email ?? ""}
                  {suggested.email && suggested.phone ? " · " : ""}
                  {suggested.phone ?? ""}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {suggested && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onLink(suggested.id)}
            >
              Link to {suggested.first_name} {suggested.last_name}
            </Button>
          )}
          <LinkClientControl
            clients={clients}
            loading={clientsLoading}
            disabled={busy}
            onLink={onLink}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onCreate}>
              Create New Admin Client
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onIgnore}>
              Ignore
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
