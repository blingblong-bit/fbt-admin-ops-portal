import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
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
} from "@/components/ui/dialog";
import {
  amountOwed,
  formatCurrency,
  formatDate,
  fullName,
  progress,
  visitsRemaining,
  type Client,
  type ClientActivity,
} from "@/lib/clients";

const searchSchema = z.object({
  edit: fallback(z.number().optional(), undefined).default(undefined),
});

export const Route = createFileRoute("/clients/$id")({
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

  const toggleScheduled = useMutation({
    mutationFn: async () => {
      if (!c) return;
      const next = !c.is_scheduled;
      const { error } = await supabase
        .from("clients")
        .update({ is_scheduled: next })
        .eq("id", id);
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: id,
        activity_type: "scheduled",
        description: next ? "Marked scheduled" : "Marked not scheduled",
      });
    },
    onSuccess: () => refresh(),
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
        <Link to="/clients" className="text-sm text-slate-500 hover:underline">
          ← All clients
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{fullName(c)}</h1>
            <StatusBadge client={c} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {c.phone ?? "no phone"} · {c.email ?? "no email"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toggleScheduled.mutate()}>
            {c.is_scheduled ? "Mark Not Scheduled" : "Mark Scheduled"}
          </Button>
          {hasVisitData && (
            <Button onClick={() => completeVisit.mutate()} disabled={remaining === 0}>
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
                <div className="text-4xl font-semibold tracking-tight text-slate-700">
                  {c.square_visit_note?.trim() || "—"}
                </div>
                <p className="text-sm text-slate-500">
                  Visit count is tracked in Square. Use the Square Visit Note field on Edit
                  Client to mirror the current count.
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
            <Row label="Square Visit Note" value={c.square_visit_note?.trim() || "—"} />
          </CardContent>
        </Card>

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

  const mutation = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!(amt > 0)) throw new Error("Enter an amount greater than 0");
      if (amt > owed) throw new Error(`Cannot exceed balance of ${formatCurrency(owed)}`);
      const newPaid = Number(client.amount_paid) + amt;
      const { error } = await supabase
        .from("clients")
        .update({ amount_paid: newPaid })
        .eq("id", client.id);
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: client.id,
        activity_type: "payment",
        description: `Payment of ${formatCurrency(amt)} recorded`,
        metadata: { amount: amt },
      });
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
  const [form, setForm] = useState({
    package_name: client.package_name ?? "",
    package_total_visits: client.package_total_visits || 8,
    package_price: client.package_price || 0,
    amount_paid: 0,
    package_start_date: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (open) {
      setForm({
        package_name: client.package_name ?? "",
        package_total_visits: client.package_total_visits || 8,
        package_price: client.package_price || 0,
        amount_paid: 0,
        package_start_date: new Date().toISOString().slice(0, 10),
      });
    }
  }, [open, client]);

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
              <Input type="date" value={form.package_start_date} onChange={(e) => up("package_start_date", e.target.value)} />
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
  useEffect(() => setForm(client), [client, open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const visitsUsedVal =
        form.visits_used === null || form.visits_used === undefined || (form.visits_used as unknown as string) === ""
          ? null
          : Number(form.visits_used);
      if (visitsUsedVal !== null && visitsUsedVal > Number(form.package_total_visits)) {
        throw new Error("Visits used cannot exceed total visits");
      }
      if (Number(form.amount_paid) > Number(form.package_price)) {
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
          square_visit_note: form.square_visit_note?.trim() || null,
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
          <Field label="Visits Used (optional — Square is source of truth)">
            <Input
              type="number"
              min={0}
              value={form.visits_used ?? ""}
              onChange={(e) =>
                up("visits_used", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="Leave blank to skip"
            />
          </Field>
          <Field label="Square Visit Note (e.g. 3/8)">
            <Input
              value={form.square_visit_note ?? ""}
              onChange={(e) => up("square_visit_note", e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Package Price">
            <Input type="number" min={0} step="0.01" value={form.package_price} onChange={(e) => up("package_price", Number(e.target.value))} />
          </Field>
          <Field label="Amount Paid">
            <Input type="number" min={0} step="0.01" value={form.amount_paid} onChange={(e) => up("amount_paid", Number(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Internal Notes">
              <Textarea rows={3} value={form.internal_notes ?? ""} onChange={(e) => up("internal_notes", e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
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
