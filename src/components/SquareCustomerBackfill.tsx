import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { backfillProductionCustomers } from '@/lib/backfill.functions';
import { invalidateFor } from '@/lib/invalidation';
import { useRole } from '@/hooks/useRole';
export function SquareCustomerBackfill() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const runBackfill = useServerFn(backfillProductionCustomers);
  const backfillMut = useMutation({
    mutationFn: async () => {
      // Batched loop — server processes ~200 customers per call to stay
      // under Cloudflare Workers' 1000-subrequest / 30s limit. Keep looping
      // until the server reports done=true so a large customer set completes
      // across multiple safe requests instead of failing silently.
      let offset = 0;
      let total = 0;
      const agg = {
        auto_linked: 0,
        queued_for_review: 0,
        hidden_old: 0,
        updated_contact: 0,
        errors: [] as string[],
      };
      const progressToast = toast.loading("Backfill starting…");
      try {
        for (let i = 0; i < 50; i++) {
          const r = await runBackfill({ data: { offset } });
          agg.auto_linked += r.auto_linked;
          agg.queued_for_review += r.queued_for_review;
          agg.hidden_old += r.hidden_old;
          agg.updated_contact += r.updated_contact;
          agg.errors.push(...r.errors);
          total = r.total;
          offset = r.next_offset;
          toast.loading(
            `Backfill: ${Math.min(offset, total)} of ${total} processed…`,
            { id: progressToast },
          );
          if (r.done) break;
        }
        toast.dismiss(progressToast);
      } catch (e) {
        toast.dismiss(progressToast);
        throw e;
      }
      return { ...agg, processed: offset, total };
    },
    onSuccess: (r) => {
      toast.success(
        `Backfill complete — ${r.processed}/${r.total} processed · ${r.auto_linked} auto-linked · ${r.queued_for_review} need review · ${r.hidden_old} hidden (old) · ${r.updated_contact} contact updates · ${r.errors.length} errors`,
      );
      invalidateFor(qc, "square-sync");
    },
    onError: (e: Error) => toast.error(`Backfill failed: ${e.message}`),
  });

  if (!isAdmin) return null;
  return <Button variant="outline" className="min-h-11 w-full justify-start whitespace-normal text-left" disabled={backfillMut.isPending} onClick={() => { if (window.confirm('Backfill Square customers using the existing matching process?')) backfillMut.mutate(); }}>{backfillMut.isPending ? 'Running backfill…' : 'Backfill Square Customers'}</Button>;
}
