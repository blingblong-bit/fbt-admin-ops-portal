import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { activatePreparedFromSquare } from "@/lib/renewal.functions";
import { invalidateFor } from "@/lib/invalidation";

/** Staff one-click: start the prepared renewal only if Square shows a verified past 1/N. */
export function ActivateFromSquareButton({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(activatePreparedFromSquare);
  const m = useMutation({
    mutationFn: () => fn({ data: { clientId } }),
    onSuccess: (r) => {
      if (r.applied) {
        toast.success(`Prepared package started from Square${r.startYmd ? ` (${r.startYmd})` : ""}.`);
        invalidateFor(qc, "renewal-changed", { clientId });
      } else {
        toast.error(`Not started: ${r.error ?? r.reason ?? "Square doesn't show a clean 1st visit yet"}. Nothing changed.`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending ? "Checking Square…" : "Activate from Square"}
    </Button>
  );
}
