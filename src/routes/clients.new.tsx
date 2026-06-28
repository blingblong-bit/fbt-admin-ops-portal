import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/clients/new")({
  head: () => ({ meta: [{ title: "Add Client · FIT Beyond Therapy Admin" }] }),
  component: AddClientPage,
});

function AddClientPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    package_name: "",
    package_total_visits: 8,
    package_price: 0,
    package_start_date: new Date().toISOString().slice(0, 10),
    amount_paid: 0,
    visits_used: 0,
    internal_notes: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim() || !form.last_name.trim()) {
        throw new Error("First and last name are required");
      }
      if (Number(form.visits_used) > Number(form.package_total_visits)) {
        throw new Error("Visits used cannot exceed total visits");
      }
      if (Number(form.amount_paid) > Number(form.package_price)) {
        throw new Error("Amount paid cannot exceed package price");
      }
      const { data, error } = await supabase
        .from("clients")
        .insert({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          package_name: form.package_name.trim() || null,
          package_total_visits: Number(form.package_total_visits),
          package_price: Number(form.package_price),
          package_start_date: form.package_start_date || null,
          amount_paid: Number(form.amount_paid),
          visits_used: Number(form.visits_used),
          internal_notes: form.internal_notes.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: data.id,
        activity_type: "created",
        description: `Client created with package "${data.package_name ?? "—"}"`,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success("Client added");
      navigate({ to: "/clients/$id", params: { id: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <AppShell>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Add Client</h1>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Client & Package Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <Field label="First Name *">
              <Input value={form.first_name} onChange={(e) => update("first_name", e.target.value)} required />
            </Field>
            <Field label="Last Name *">
              <Input value={form.last_name} onChange={(e) => update("last_name", e.target.value)} required />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </Field>

            <div className="sm:col-span-2 mt-2 border-t pt-4">
              <h3 className="text-sm font-semibold text-slate-700">Package</h3>
            </div>
            <Field label="Package Name">
              <Input value={form.package_name} onChange={(e) => update("package_name", e.target.value)} placeholder="e.g. 8-Visit Package" />
            </Field>
            <Field label="Package Start Date">
              <Input type="date" value={form.package_start_date} onChange={(e) => update("package_start_date", e.target.value)} />
            </Field>
            <Field label="Total Visits">
              <Input type="number" min={0} value={form.package_total_visits} onChange={(e) => update("package_total_visits", Number(e.target.value))} />
            </Field>
            <Field label="Visits Used">
              <Input type="number" min={0} max={form.package_total_visits} value={form.visits_used} onChange={(e) => update("visits_used", Number(e.target.value))} />
            </Field>
            <Field label="Package Price ($)">
              <Input type="number" min={0} step="0.01" value={form.package_price} onChange={(e) => update("package_price", Number(e.target.value))} />
            </Field>
            <Field label="Amount Paid Today ($)">
              <Input type="number" min={0} step="0.01" max={form.package_price} value={form.amount_paid} onChange={(e) => update("amount_paid", Number(e.target.value))} />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Internal Notes">
                <Textarea rows={4} value={form.internal_notes} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </div>

            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate({ to: "/clients" })}>
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
