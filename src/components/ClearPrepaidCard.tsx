import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { clearUnallocatedPrepaid } from "@/lib/admin-finance.functions";

/** Admin-only quick fix for leftover paid-ahead money so renewals aren't blocked. */
export function ClearPrepaidCard({ clientId, paidAhead, preparedOn, onDone }: { clientId: string; paidAhead: number; preparedOn: string | null; onDone: () => void }) {
  const clear = useServerFn(clearUnallocatedPrepaid);
  const [busy, setBusy] = useState(false);
  if (!(paidAhead > 0) && !preparedOn) return null;
  const run = async () => {
    const reason = window.prompt(`Clear $${paidAhead.toFixed(2)} paid ahead${preparedOn ? ` and the renewal prepared for ${preparedOn}` : ""}? Payment history is kept.\n\nReason:`, "Old paid-ahead money — client is paid up");
    if (!reason?.trim()) return;
    setBusy(true);
    try { await clear({ data: { clientId, reason } }); toast.success("Cleared. Renewal can go ahead."); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-md border p-3" aria-label="Paid-ahead money">
      <p className="text-sm"><b>${paidAhead.toFixed(2)}</b> recorded as paid ahead{preparedOn ? ` for a renewal prepared ${preparedOn}` : ""}. If this is old money, clear it so renewals work.</p>
      <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={run}>{busy ? "Clearing…" : "Clear paid-ahead"}</Button>
    </section>
  );
}
