import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/clients";

export const Route = createFileRoute("/clients/new")({
  head: () => ({ meta: [{ title: "Add Client · FIT Beyond Therapy Admin" }] }),
  component: AddClientPage,
});

function packageLabel(totalVisits: number): string {
  if (!totalVisits || totalVisits <= 0) return "Custom Package";
  if ([4, 8, 12, 16, 20, 24].includes(totalVisits)) return `${totalVisits} Visit Package`;
  return `${totalVisits} Visit Package`;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function AddClientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    begin_date: new Date().toISOString().slice(0, 10),
    package_price: "" as number | "",
    package_total_visits: 8 as number | "",
    payment_today: "" as number | "",
    is_scheduled: false,
    internal_notes: "",
  });

  const price = Number(form.package_price || 0);
  const paid = Number(form.payment_today || 0);
  const total = Number(form.package_total_visits || 0);
  const owed = Math.max(0, price - paid);
  const label = useMemo(() => packageLabel(total), [total]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Client name is required");
      if (!form.phone.trim()) throw new Error("Phone number is required");
      if (!form.begin_date) throw new Error("Begin date is required");
      if (price < 0) throw new Error("Package price cannot be negative");
      if (paid < 0) throw new Error("Payment amount cannot be negative");
      if (total <= 0) throw new Error("Package total visits must be greater than 0");
      if (paid > price) throw new Error("Payment cannot exceed package price");

      const { first, last } = splitName(form.name);

      const { data, error } = await supabase
        .from("clients")
        .insert({
          first_name: first,
          last_name: last,
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          package_name: label,
          package_total_visits: total,
          package_price: price,
          package_start_date: form.begin_date,
          amount_paid: paid,
          visits_used: 0,
          is_scheduled: form.is_scheduled,
          internal_notes: form.internal_notes.trim() || null,
        } as never)
        .select()
        .single();
      if (error) throw error;

      const activities = [
        {
          client_id: data.id,
          activity_type: "created",
          description: "Client created.",
        },
      ];
      if (paid > 0) {
        activities.push({
          client_id: data.id,
          activity_type: "payment",
          description: `Initial payment of ${formatCurrency(paid)} recorded.`,
        });
      }
      await supabase.from("client_activities").insert(activities);

      return data;
    },
    onSuccess: (data) => {
      toast.success("Client added");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      navigate({ to: "/clients/$id", params: { id: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">Add Client</h1>
      <p className="mb-6 text-sm text-slate-500">
        Quick entry — only the essentials. You can edit details later.
      </p>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>New Client</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Client Name *">
                <Input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="First Last"
                  required
                  autoFocus
                />
              </Field>
            </div>

            <Field label="Phone Number *">
              <Input
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="931-555-1234"
                required
              />
            </Field>
            <Field label="Email (optional)">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </Field>

            <Field label="Begin Date *">
              <Input
                type="date"
                value={form.begin_date}
                onChange={(e) => update("begin_date", e.target.value)}
                required
              />
            </Field>
            <Field label="Total Visits *">
              <Input
                type="number"
                min={1}
                value={form.package_total_visits}
                onChange={(e) =>
                  update(
                    "package_total_visits",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                required
              />
            </Field>

            <Field label="Package Price ($) *">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.package_price}
                onChange={(e) =>
                  update("package_price", e.target.value === "" ? "" : Number(e.target.value))
                }
                required
              />
            </Field>
            <Field label="Payment Received Today ($) *">
              <Input
                type="number"
                min={0}
                step="0.01"
                max={price || undefined}
                value={form.payment_today}
                onChange={(e) =>
                  update("payment_today", e.target.value === "" ? "" : Number(e.target.value))
                }
                required
              />
            </Field>

            <div className="sm:col-span-2 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span>
                  <span className="text-slate-500">Package:</span>{" "}
                  <strong>{label}</strong>
                </span>
                <span>
                  <span className="text-slate-500">Amount Owed:</span>{" "}
                  <strong>{formatCurrency(owed)}</strong>
                </span>
                <span>
                  <span className="text-slate-500">Visits Remaining:</span>{" "}
                  <strong>{total || 0}</strong>
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <Field label="Scheduled Status">
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant={form.is_scheduled ? "default" : "outline"}
                    size="sm"
                    onClick={() => update("is_scheduled", true)}
                  >
                    ✅ Scheduled
                  </Button>
                  <Button
                    type="button"
                    variant={!form.is_scheduled ? "default" : "outline"}
                    size="sm"
                    onClick={() => update("is_scheduled", false)}
                  >
                    ⭕ Not Scheduled
                  </Button>
                </div>
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Internal Notes (optional)">
                <Textarea
                  rows={3}
                  value={form.internal_notes}
                  onChange={(e) => update("internal_notes", e.target.value)}
                  placeholder="Anything the front desk should know…"
                />
              </Field>
            </div>

            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate({ to: "/" })}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Save Client"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
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
