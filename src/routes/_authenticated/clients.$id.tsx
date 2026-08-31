import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "@/components/ui/sonner";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recordManualPayment } from "@/lib/payments.functions";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { RenewalFlagBadge, useIsRenewalFlagged } from "@/components/RenewalFlagBadge";
import {
  PackageReviewBadge,
  usePackageReviewDismissedIds,
  DISMISS_ACTIVITY,
  UNDISMISS_ACTIVITY,
} from "@/components/PackageReviewBadge";


import { getScheduledClientIds, getClientAppointments, type ClientAppointment } from "@/lib/schedule.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  amountOwed,
  formatCurrency,
  formatDate,
  fullName,
  needsPackageReview,

  progress,
  visitsRemaining,
  type Client,
  type ClientActivity,
} from "@/lib/clients";

const searchSchema = z.object({
  edit: fallback(z.number().optional(), undefined).default(undefined),
});

export const Route = createFileRoute("/_authenticated/clients/$id")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: "Client · FIT Beyond Therapy Admin" }] }),
  component: ClientDetailPage,
});

function useClient(id: string) {
  return useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Client;
    },
  });
}

function useActivities(id: string) {
  return useQuery({
    queryKey: ["activities", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_activities")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ClientActivity[];
    },
  });
}

function ClientDetailPage() {
  const { id } = Route.useParams();
  const { edit } = Route.useSearch();
  const { data: c, isLoading } = useClient(id);
  const { data: activities = [] } = useActivities(id);
  const fetchScheduledIds = useServerFn(getScheduledClientIds);
  const scheduledQuery = useQuery({
    queryKey: ["scheduled-client-ids"],
    queryFn: () => fetchScheduledIds({ data: { days: 30 } }),
    staleTime: 60_000,
  });
  const isScheduled = scheduledQuery.data?.client_ids.includes(id) ?? false;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);


  useEffect(() => {
    if (edit) setEditOpen(true);
  }, [edit]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["client", id] });
    qc.invalidateQueries({ queryKey: ["activities", id] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const completeVisit = useMutation({
    mutationFn: async () => {
      if (!c) return;
      const current = c.visits_used ?? 0;
      if (current >= c.package_total_visits) {
        throw new Error("All visits already used");
      }
      const next = current + 1;
      const { error } = await supabase
        .from("clients")
        .update({ visits_used: next })
        .eq("id", id);
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: id,
        activity_type: "visit",
        description: `Visit completed (${next}/${c.package_total_visits})`,
      });
    },
    onSuccess: () => {
      toast.success("Visit recorded");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Scheduling is derived from live Square bookings — no manual toggle.
  const renewalFlagged = useIsRenewalFlagged(id);

  // "First Visit — No Package Info, Needs Review"
  const dismissedIds = usePackageReviewDismissedIds().data ?? null;
  const isDismissedFromReview = !!dismissedIds?.has(id);
  const packageReviewNeeded = !!c && needsPackageReview(c, dismissedIds, id);
  const packageReviewMut = useMutation({
    mutationFn: async (dismiss: boolean) => {
      const { error } = await supabase.from("client_activities").insert({
        client_id: id,
        activity_type: dismiss ? DISMISS_ACTIVITY : UNDISMISS_ACTIVITY,
        description: dismiss
          ? "Marked as not needing a package (assessment only)"
          : "Re-flagged for package review",
      });
      if (error) throw error;
    },
    onSuccess: (_d, dismiss) => {
      toast.success(dismiss ? "Marked as not needing a package" : "Re-flagged for package review");
      qc.invalidateQueries({ queryKey: ["package_review_dismissals"] });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });




  if (isLoading || !c) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }

  const remaining = visitsRemaining(c);
  const owed = amountOwed(c);
  const hasVisitData = c.visits_used !== null && c.visits_used !== undefined;
  const pct =
    hasVisitData && c.package_total_visits > 0
      ? ((c.visits_used as number) / c.package_total_visits) * 100
      : 0;

  return (
    <AppShell>
      <div className="mb-6">
        <BackLink />
      </div>


      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{fullName(c)}</h1>
            <StatusBadge client={c} isScheduled={isScheduled} />
            {renewalFlagged && <RenewalFlagBadge />}
          </div>

          <p className="mt-1 text-sm text-slate-500">
            {c.phone ?? "no phone"} · {c.email ?? "no email"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Schedule status is read live from Square — manage appointments in Square.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap gap-2">

            {(c.package_total_visits ?? 0) > 0 && remaining !== 0 && (
              <Button
                onClick={() => completeVisit.mutate()}
                title={!hasVisitData ? "Visits unknown — verify before completing." : undefined}
              >
                Complete Visit
              </Button>
            )}
            <Button variant="outline" onClick={() => setPaymentOpen(true)} disabled={owed === 0}>
              Record Payment
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit Client
            </Button>
            <Button variant="outline" onClick={() => setRenewOpen(true)}>
              Renew Package
            </Button>
          </div>
          {(c.package_total_visits ?? 0) > 0 && !hasVisitData && (
            <span className="text-xs text-amber-700">
              ⚠ Visits unknown — verify before completing.
            </span>
          )}
          {(c.package_total_visits ?? 0) > 0 && remaining === 0 && (
            <span className="text-xs text-amber-700">
              ⚠ Visits show 0 — verify in Square before completing.
            </span>
          )}
        </div>
      </div>


      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Visit Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {hasVisitData ? (
              <>
                <div className="mb-2 flex items-end justify-between">
                  <div className="text-4xl font-semibold tracking-tight">{progress(c)}</div>
                  <div className="text-sm text-slate-500">{remaining} remaining</div>
                </div>
                <Progress value={pct} className="h-3" />
              </>
            ) : (
              <div className="space-y-2">
                <div className="text-4xl font-semibold tracking-tight text-slate-700">—</div>
                <p className="text-sm text-slate-500">
                  Visit count is tracked in Square. Set Visits Used on Edit Client to mirror
                  the current count.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Package Price" value={formatCurrency(c.package_price)} />
            <Row label="Amount Paid" value={formatCurrency(c.amount_paid)} />
            <Row
              label="Amount Owed"
              value={formatCurrency(owed)}
              valueClass={owed > 0 ? "text-red-600 font-semibold" : ""}
            />
            {(() => {
              const last = activities.find(
                (a) =>
                  a.activity_type === "payment" &&
                  (a.metadata as Record<string, unknown> | null)?.source === "square",
              );
              if (!last) {
                return <Row label="Last paid" value="No Square payment on record" />;
              }
              const meta = last.metadata as Record<string, unknown> | null;
              const amt = Number(meta?.applied_amount ?? meta?.amount ?? 0);
              return (
                <Row
                  label="Last paid"
                  value={`${formatCurrency(amt)} on ${formatDate(last.created_at)}`}
                />
              );
            })()}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Package</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Name" value={c.package_name ?? "—"} />
            <Row label="Start Date" value={formatDate(c.package_start_date)} />
            <Row label="Total Visits" value={c.package_total_visits} />
            <Row label="Visits Used" value={hasVisitData ? c.visits_used : "—"} />
            
          </CardContent>
        </Card>

        <AppointmentsCard clientId={id} />

        <Card>
          <CardHeader>
            <CardTitle>Internal Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {c.internal_notes ?? <span className="text-slate-400">No notes.</span>}
            </p>
          </CardContent>
        </Card>





        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ul className="divide-y">
                {activities.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium capitalize">
                        {a.activity_type.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-slate-500">{a.description}</div>
                    </div>
                    <div className="text-xs text-slate-400">
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        client={c}
        onDone={refresh}
      />
      <RenewDialog
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        client={c}
        onDone={refresh}
      />
      <EditDialog
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          if (edit) navigate({ to: "/clients/$id", params: { id }, search: {} });
        }}
        client={c}
        onDone={refresh}
      />
    </AppShell>
  );
}

function Row({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function PaymentDialog({
  open,
  onClose,
  client,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  client: Client;
  onDone: () => void;
}) {
  const owed = amountOwed(client);
  const [amount, setAmount] = useState(owed);
  useEffect(() => setAmount(owed), [owed, open]);
  const recordPayment = useServerFn(recordManualPayment);

  const mutation = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter an amount greater than 0");
      if (amt > owed) throw new Error(`Cannot exceed balance of ${formatCurrency(owed)}`);
      // Routed through a server function: apply_square_payment is EXECUTE-
      // granted to service_role only, so the browser client can't call it.
      // The RPC locks the client row, checks idempotency by payment id,
      // updates amount_paid, and inserts the activity row in one transaction.
      const amountCents = Math.round(amt * 100);
      const result = await recordPayment({
        data: { client_id: client.id, amount_cents: amountCents },
      });
      if (!result.credited) {
        throw new Error("Payment was not applied (duplicate id — try again).");
      }
    },

    onSuccess: () => {
      toast.success("Payment recorded");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Outstanding balance: <strong>{formatCurrency(owed)}</strong>
          </p>
          <Label>Payment Amount ($)</Label>
          <Input
            type="number"
            min={0}
            max={owed}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CLINIC_TZ = "America/Chicago";

/** Clinic-local YYYY-MM-DD for an instant. */
function clinicYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function RenewDialog({
  open,
  onClose,
  client,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  client: Client;
  onDone: () => void;
}) {
  // The new package starts when the client next comes in — not the day staff
  // happened to click Renew. Prefill from the earliest upcoming Square
  // appointment; today's date is only a fallback.
  const fetchAppts = useServerFn(getClientAppointments);
  const upcomingQuery = useQuery({
    queryKey: ["client-appointments", client.id, "upcoming"],
    queryFn: () => fetchAppts({ data: { clientId: client.id, ...windowIso(0, WINDOW_DAYS) } }),
    staleTime: 60_000,
    enabled: open,
  });
  const nextApptYmd = (() => {
    const appts = upcomingQuery.data?.appointments ?? [];
    const next = appts
      .filter((a) => !/CANCEL|DECLINE|NO_SHOW/i.test(a.status))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
    return next ? clinicYmd(new Date(next.start_at)) : null;
  })();

  const [form, setForm] = useState({
    package_name: client.package_name ?? "",
    package_total_visits: client.package_total_visits || 8,
    package_price: client.package_price || 0,
    amount_paid: 0,
    package_start_date: clinicYmd(new Date()),
  });
  const [startDateTouched, setStartDateTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setStartDateTouched(false);
      setForm({
        package_name: client.package_name ?? "",
        package_total_visits: client.package_total_visits || 8,
        package_price: client.package_price || 0,
        amount_paid: 0,
        package_start_date: nextApptYmd ?? clinicYmd(new Date()),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  // Appointments may resolve after the dialog opens — apply the prefill then,
  // unless staff already edited the field.
  useEffect(() => {
    if (!open || startDateTouched || !nextApptYmd) return;
    setForm((f) => (f.package_start_date === nextApptYmd ? f : { ...f, package_start_date: nextApptYmd }));
  }, [open, startDateTouched, nextApptYmd]);


  const mutation = useMutation({
    mutationFn: async () => {
      if (Number(form.amount_paid) > Number(form.package_price)) {
        throw new Error("Amount paid cannot exceed package price");
      }
      // Reset visits_used first to satisfy validation trigger.
      const { error: e1 } = await supabase
        .from("clients")
        .update({ visits_used: 0, amount_paid: 0 })
        .eq("id", client.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("clients")
        .update({
          package_name: form.package_name.trim() || null,
          package_total_visits: Number(form.package_total_visits),
          package_price: Number(form.package_price),
          package_start_date: form.package_start_date || null,
          amount_paid: Number(form.amount_paid),
        })
        .eq("id", client.id);
      if (e2) throw e2;
      await supabase.from("client_activities").insert({
        client_id: client.id,
        activity_type: "renewal",
        description: `Package renewed: "${form.package_name}" (${form.package_total_visits} visits, ${formatCurrency(form.package_price)})`,
        metadata: form,
      });
    },
    onSuccess: () => {
      toast.success("Package renewed");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const up = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew Package</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Package Name</Label>
            <Input value={form.package_name} onChange={(e) => up("package_name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total Visits</Label>
              <Input type="number" min={1} value={form.package_total_visits} onChange={(e) => up("package_total_visits", Number(e.target.value))} />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={form.package_start_date}
                onChange={(e) => {
                  setStartDateTouched(true);
                  up("package_start_date", e.target.value);
                }}
              />
              <p className="mt-1 text-xs text-slate-500">
                {nextApptYmd && form.package_start_date === nextApptYmd
                  ? "From next Square appointment — editable"
                  : upcomingQuery.isLoading
                    ? "Checking next appointment…"
                    : nextApptYmd
                      ? "Manually set"
                      : "No upcoming appointment found — defaulted to today"}
              </p>
            </div>

            <div>
              <Label>Price ($)</Label>
              <Input type="number" min={0} step="0.01" value={form.package_price} onChange={(e) => up("package_price", Number(e.target.value))} />
            </div>
            <div>
              <Label>Paid Today ($)</Label>
              <Input type="number" min={0} step="0.01" max={form.package_price} value={form.amount_paid} onChange={(e) => up("amount_paid", Number(e.target.value))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  open,
  onClose,
  client,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  client: Client;
  onDone: () => void;
}) {
  const [form, setForm] = useState(client);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  useEffect(() => setForm(client), [client, open]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("clients")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", client.id);
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: client.id,
        activity_type: "deleted",
        description: "Client moved to Deleted Clients",
      });
    },
    onSuccess: () => {
      toast.success("Moved to Deleted Clients");
      setConfirmDelete(false);
      onDone();
      onClose();
      navigate({ to: "/clients" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const visitsUsedVal =
        form.visits_used === null || form.visits_used === undefined || (form.visits_used as unknown as string) === ""
          ? null
          : Number(form.visits_used);
      if (visitsUsedVal !== null && visitsUsedVal > Number(form.package_total_visits)) {
        throw new Error("Visits used cannot exceed total visits");
      }
      if (form.payment_model !== "pay_per_visit" && Number(form.amount_paid) > Number(form.package_price)) {
        throw new Error("Amount paid cannot exceed package price");
      }
      const { error } = await supabase
        .from("clients")
        .update({
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone || null,
          email: form.email || null,
          package_name: form.package_name || null,
          package_total_visits: Number(form.package_total_visits),
          package_price: Number(form.package_price),
          package_start_date: form.package_start_date || null,
          visits_used: visitsUsedVal,
          amount_paid: Number(form.amount_paid),
          internal_notes: form.internal_notes || null,
          payment_model: form.payment_model === "pay_per_visit" ? "pay_per_visit" : "package",
          manual_active: Boolean(form.manual_active),
          status: form.manual_active ? "active" : form.status,
        } as never)
        .eq("id", client.id);


      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: client.id,
        activity_type: "edit",
        description: "Client details edited",
      });
    },
    onSuccess: () => {
      toast.success("Saved");
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const up = <K extends keyof Client>(k: K, v: Client[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First Name">
            <Input value={form.first_name} onChange={(e) => up("first_name", e.target.value)} />
          </Field>
          <Field label="Last Name">
            <Input value={form.last_name} onChange={(e) => up("last_name", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone ?? ""} onChange={(e) => up("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.email ?? ""} onChange={(e) => up("email", e.target.value)} />
          </Field>
          <Field label="Package Name">
            <Input value={form.package_name ?? ""} onChange={(e) => up("package_name", e.target.value)} />
          </Field>
          <Field label="Start Date">
            <Input type="date" value={form.package_start_date ?? ""} onChange={(e) => up("package_start_date", e.target.value)} />
          </Field>
          <Field label="Total Visits">
            <Input type="number" min={0} value={form.package_total_visits} onChange={(e) => up("package_total_visits", Number(e.target.value))} />
          </Field>
          <Field label="Visits Used">
            <Input
              type="number"
              min={0}
              value={form.visits_used ?? ""}
              onChange={(e) =>
                up("visits_used", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Package Price">
            <Input type="number" min={0} step="0.01" value={form.package_price} onChange={(e) => up("package_price", Number(e.target.value))} />
          </Field>
          <Field label="Amount Paid">
            <Input type="number" min={0} step="0.01" value={form.amount_paid} onChange={(e) => up("amount_paid", Number(e.target.value))} />
          </Field>
          {Number(form.package_total_visits) === 0 && (
            <Field label="Payment Model">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.payment_model === "pay_per_visit" ? "pay_per_visit" : "package"}
                onChange={(e) => up("payment_model", e.target.value)}
              >
                <option value="package">Package (default)</option>
                <option value="pay_per_visit">Pay-per-visit (hides Amount Owed, uncapped ledger)</option>
              </select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Internal Notes">
              <Textarea rows={3} value={form.internal_notes ?? ""} onChange={(e) => up("internal_notes", e.target.value)} />
            </Field>
          </div>

          <div className="sm:col-span-2 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <input
              id="manual-active"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={Boolean(form.manual_active)}
              onChange={(e) => up("manual_active", e.target.checked)}
            />
            <label htmlFor="manual-active" className="text-sm">
              <span className="font-medium text-slate-800">Pin as Active</span>
              <span className="block text-xs text-slate-500">
                Keep this client visible on the dashboard even with no upcoming booking, no balance, and no visits remaining. Prevents the inactive-cleanup tool from archiving them.
              </span>
            </label>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => setConfirmDelete(true)}
          >
            Delete Client
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <Dialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Deleted Clients?</DialogTitle>
            <DialogDescription>
              Move <strong>{fullName(client)}</strong> to Deleted Clients? You can restore them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Move to Deleted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

function formatApptDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatApptTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function AppointmentRow({ a }: { a: ClientAppointment }) {
  const status = a.status.replace(/_/g, " ");
  const statusClass = /CANCEL|NO_SHOW|DECLINE/i.test(a.status)
    ? "bg-red-50 text-red-700 border-red-200"
    : /ACCEPTED|CONFIRMED/i.test(a.status)
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <li className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">
            {formatApptDate(a.start_at)}
          </div>
          <div className="text-xs text-slate-500">{formatApptTime(a.start_at)}</div>
        </div>
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${statusClass}`}
        >
          {status.toLowerCase()}
        </span>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-slate-600">
        <div>
          <span className="text-slate-400">Type: </span>
          {a.service_name ?? "—"}
        </div>
        <div>
          <span className="text-slate-400">Provider: </span>
          {a.team_member_name ?? "—"}
        </div>
      </div>
    </li>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 31;

function windowIso(offsetDaysStart: number, offsetDaysEnd: number) {
  const now = Date.now();
  return {
    startIso: new Date(now + offsetDaysStart * MS_PER_DAY).toISOString(),
    endIso: new Date(now + offsetDaysEnd * MS_PER_DAY).toISOString(),
  };
}

function AppointmentsCard({ clientId }: { clientId: string }) {
  const fetchAppts = useServerFn(getClientAppointments);
  const [showPrev, setShowPrev] = useState(false);
  // Number of 31-day windows into the past we've loaded (starts at 1 = last 31 days).
  const [pastWindows, setPastWindows] = useState(1);

  const upcomingQuery = useQuery({
    queryKey: ["client-appointments", clientId, "upcoming"],
    queryFn: () => fetchAppts({ data: { clientId, ...windowIso(0, WINDOW_DAYS) } }),
    staleTime: 60_000,
  });

  const previousQuery = useQuery({
    queryKey: ["client-appointments", clientId, "previous", pastWindows],
    queryFn: async () => {
      const results: ClientAppointment[] = [];
      let errored = false;
      for (let i = 0; i < pastWindows; i++) {
        const range = windowIso(-WINDOW_DAYS * (i + 1), -WINDOW_DAYS * i);
        const res = await fetchAppts({ data: { clientId, ...range } });
        if (res.error) errored = true;
        results.push(...res.appointments);
      }
      return {
        appointments: results.sort((a, b) => b.start_at.localeCompare(a.start_at)),
        error: errored ? ("unavailable" as const) : null,
      };
    },
    enabled: showPrev,
    staleTime: 60_000,
  });

  const upcoming = upcomingQuery.data?.appointments ?? [];
  const previous = previousQuery.data?.appointments ?? [];

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">
            Upcoming ({upcoming.length})
          </h3>
          {upcomingQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading appointments…</p>
          ) : upcomingQuery.isError || upcomingQuery.data?.error ? (
            <p className="text-sm text-red-600">
              Unable to load appointments. Please try again.
            </p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">No appointments found.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {upcoming.map((a) => (
                <AppointmentRow key={a.booking_id} a={a} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <button
            type="button"
            onClick={() => setShowPrev((s) => !s)}
            className="mb-2 flex min-h-11 w-full items-center justify-between text-sm font-semibold text-slate-700 cursor-pointer hover:underline"
          >
            <span>Previous Appointments</span>
            <span className="text-xs text-slate-400">{showPrev ? "Hide" : "Show"}</span>
          </button>
          {showPrev && (
            <>
              {previousQuery.isLoading ? (
                <p className="text-sm text-slate-500">Loading appointments…</p>
              ) : previousQuery.isError || previousQuery.data?.error ? (
                <p className="text-sm text-red-600">
                  Unable to load appointments. Please try again.
                </p>
              ) : previous.length === 0 ? (
                <p className="text-sm text-slate-500">No appointments found.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {previous.map((a) => (
                    <AppointmentRow key={a.booking_id} a={a} />
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPastWindows((n) => n + 1)}
                  disabled={previousQuery.isFetching}
                >
                  {previousQuery.isFetching
                    ? "Loading…"
                    : `Load Older Appointments (previous ${WINDOW_DAYS} days)`}
                </Button>
              </div>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function BackLink() {
  const router = useRouter();
  const canGoBack = router.history.length > 1;
  if (!canGoBack) {
    return (
      <Link to="/clients" className="text-sm text-slate-500 hover:underline">
        ← All clients
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => router.history.back()}
      className="text-sm text-slate-500 hover:underline"
    >
      ← Back
    </button>
  );
}




