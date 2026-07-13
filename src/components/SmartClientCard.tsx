import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  amountOwed,
  formatCurrency,
  fullName,
  primaryAction,
  type Client,
} from "@/lib/clients";

export type ScheduleStatus = "this_week" | "next_week" | "not_scheduled" | "carried_over";

export function SmartClientCard({
  client,
  isScheduled,
  hideAmount = false,
  scheduleStatus,
  scheduleStatusDetail,
}: {
  client: Client;
  /** Derived from live Square bookings. */
  isScheduled: boolean;
  /** For staff role: hide the dollar balance chip on this card (multi-client grid). */
  hideAmount?: boolean;
  /** Optional weekly-scheduling badge shown next to the status badge. */
  scheduleStatus?: ScheduleStatus;
  /** Extra text appended to the schedule tag (e.g. carried-over week range). */
  scheduleStatusDetail?: string;
}) {
  const qc = useQueryClient();
  const owed = amountOwed(client);
  const action = primaryAction(client, isScheduled);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["client", client.id] });
  };

  const primary = (() => {
    switch (action) {
      case "record_payment":
        return (
          <Button size="lg" className="w-full" onClick={() => setPaymentOpen(true)}>
            💰 Record Payment
          </Button>
        );
      case "mark_scheduled":
        // Scheduling is read-only from Square. Staff schedule the client in Square,
        // and this card will flip to Active on the next refresh.
        return (
          <Link to="/clients/$id" params={{ id: client.id }} className="block">
            <Button size="lg" variant="outline" className="w-full">
              📅 Schedule in Square
            </Button>
          </Link>
        );
      case "renew_package":
        return (
          <Link to="/clients/$id" params={{ id: client.id }} className="block">
            <Button size="lg" className="w-full">
              🔄 Renew Package
            </Button>
          </Link>
        );
      case "view_client":
        return (
          <Link to="/clients/$id" params={{ id: client.id }} className="block">
            <Button size="lg" className="w-full">
              👤 View Client
            </Button>
          </Link>
        );
    }
  })();

  return (
    <div className="flex flex-col rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/clients/$id"
            params={{ id: client.id }}
            className="block truncate text-lg font-semibold tracking-tight hover:underline"
          >
            {fullName(client)}
          </Link>
          {client.phone && (
            <div className="mt-0.5 text-sm text-slate-500">📞 {client.phone}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge client={client} isScheduled={isScheduled} />
          {scheduleStatus && <ScheduleStatusBadge status={scheduleStatus} />}
        </div>
      </div>


      <dl className="mb-4 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Package</dt>
          <dd className="text-right text-slate-800">{client.package_name ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Balance</dt>
          <dd
            className={`text-right font-semibold ${
              owed > 0 ? "text-red-600" : "text-slate-700"
            }`}
          >
            {hideAmount ? (owed > 0 ? "Owes" : "Paid") : owed > 0 ? formatCurrency(owed) : "Paid"}
          </dd>
        </div>
      </dl>

      {client.internal_notes && (
        <div className="mb-4 line-clamp-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          📝 {client.internal_notes}
        </div>
      )}

      <div className="mt-auto space-y-2">
        {primary}
        {action !== "view_client" && (
          <Link to="/clients/$id" params={{ id: client.id }} className="block">
            <Button variant="ghost" size="sm" className="w-full">
              View Client
            </Button>
          </Link>
        )}
      </div>

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        client={client}
        onDone={refresh}
      />
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
          <DialogTitle>Record Payment · {fullName(client)}</DialogTitle>
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

function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const map: Record<ScheduleStatus, { label: string; cls: string }> = {
    this_week: {
      label: "Due this week",
      cls: "bg-sky-100 text-sky-800 border-sky-200",
    },
    next_week: {
      label: "Due next week",
      cls: "bg-indigo-100 text-indigo-800 border-indigo-200",
    },
    not_scheduled: {
      label: "Not currently scheduled",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
