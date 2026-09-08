import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
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
import { formatCurrency, formatDate } from "@/lib/clients";
import {
  cancelPendingRenewal,
  preRenewNextPackage,
  type RenewalForecastRow,
} from "@/lib/schedule.functions";

/**
 * Needs Renewal detail + "Pre-Renew Next Package".
 *
 * Pre-renewal stores the prepared package only. The active package and its
 * visit count are untouched until the first uncovered appointment is checked
 * in, which is what activates the prepared package (never 9/8).
 */
export function PreRenewCard({
  forecast,
  hideAmount = false,
}: {
  forecast: RenewalForecastRow;
  hideAmount?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const preRenew = useServerFn(preRenewNextPackage);
  const cancelPending = useServerFn(cancelPendingRenewal);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["renewal-forecast"] });
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["client", forecast.client_id] });
  };

  const cancelMutation = useMutation({
    mutationFn: () => cancelPending({ data: { clientId: forecast.client_id } }),
    onSuccess: () => {
      toast.success("Prepared package cancelled");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startYmd = forecast.pending_start_ymd ?? forecast.first_uncovered_ymd;

  return (
    <div className="-mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <div>
        {forecast.visits_used} of {forecast.package_total_visits} visits used ·{" "}
        {forecast.remaining} remaining · {forecast.upcoming_count} upcoming
        {forecast.upcoming_count === 1 ? " appointment" : " appointments"}
      </div>
      {forecast.no_upcoming ? (
        <div className="mt-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 font-semibold">
          Prepared Renewal — No Upcoming Appointment. Nothing is booked, so this isn't counted in
          any weekly payment total. Edit or cancel it below.
        </div>
      ) : (
        <div className="mt-1">
          First uncovered appointment: {formatDate(forecast.first_uncovered_ymd)}
        </div>
      )}
      {startYmd && (
        <div className="mt-1 font-medium">New package starts {formatDate(startYmd)}</div>
      )}
      {!hideAmount && (
        <div className="mt-1">
          Next package amount: {formatCurrency(forecast.next_package_price)}
          {forecast.pending_total_visits ? ` · ${forecast.pending_total_visits} visits` : ""}
        </div>
      )}

      {forecast.pre_renewed ? (
        <div className="mt-2 space-y-2">
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-900">
            {forecast.no_upcoming
              ? "Renewal prepared — activates at the first check-in on or after its start date"
              : `✅ Renewal scheduled for ${formatDate(startYmd)} — activates at that check-in`}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel renewal
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] italic text-amber-800">Forecast only — not yet prepared</div>
          <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>
            Pre-Renew Next Package
          </Button>
        </div>
      )}

      <PreRenewDialog
        open={open}
        onClose={() => setOpen(false)}
        forecast={forecast}
        onSubmit={(v) =>
          preRenew({
            data: {
              clientId: forecast.client_id,
              startYmd: v.startYmd,
              price: v.price,
              totalVisits: v.totalVisits,
              packageName: v.packageName,
            },
          })
        }
        onDone={refresh}
      />
    </div>
  );
}

function PreRenewDialog({
  open,
  onClose,
  forecast,
  onSubmit,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  forecast: RenewalForecastRow;
  onSubmit: (v: {
    startYmd: string;
    price: number;
    totalVisits: number;
    packageName: string;
  }) => Promise<unknown>;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    startYmd: forecast.pending_start_ymd ?? forecast.first_uncovered_ymd,
    price: forecast.next_package_price,
    totalVisits: forecast.pending_total_visits ?? forecast.package_total_visits,
    packageName: forecast.pending_package_name ?? "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      startYmd: forecast.pending_start_ymd ?? forecast.first_uncovered_ymd,
      price: forecast.next_package_price,
      totalVisits: forecast.pending_total_visits ?? forecast.package_total_visits,
      packageName: forecast.pending_package_name ?? "",
    });
  }, [open, forecast]);

  const mutation = useMutation({
    mutationFn: () => onSubmit(form),
    onSuccess: () => {
      toast.success(`Next package scheduled for ${formatDate(form.startYmd)}`);
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
          <DialogTitle>Pre-Renew Next Package</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500">
          This prepares the next package only. The current package keeps its visit count until the
          first uncovered appointment is checked in.
        </p>
        <div className="grid gap-3">
          <div>
            <Label>Package Name</Label>
            <Input
              value={form.packageName}
              onChange={(e) => up("packageName", e.target.value)}
              placeholder="Same as current"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={form.startYmd}
                onChange={(e) => up("startYmd", e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                From first uncovered appointment — editable
              </p>
            </div>
            <div>
              <Label>Total Visits</Label>
              <Input
                type="number"
                min={1}
                value={form.totalVisits}
                onChange={(e) => up("totalVisits", Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Price ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => up("price", Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Schedule Renewal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
