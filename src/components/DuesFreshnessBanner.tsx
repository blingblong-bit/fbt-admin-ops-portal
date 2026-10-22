import { Button } from "@/components/ui/button";
import { duesFreshness, lastUpdatedLabel, type Freshness } from "@/lib/dues-freshness";

type Q = {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  data?: { computed_at?: string | null } | undefined;
  refetch: () => unknown;
};

export function useDuesFreshness(q: Q): { state: Freshness; untrusted: boolean; label: string } {
  const state = duesFreshness({ ...q, hasData: q.data !== undefined });
  return { state, untrusted: q.isError && q.data !== undefined, label: lastUpdatedLabel(q.dataUpdatedAt, q.data?.computed_at) };
}

/** "Updating…" during a normal background refresh; red "Out of date" when the last refresh failed. */
export function DuesFreshnessBanner({ q }: { q: Q }) {
  const f = useDuesFreshness(q);
  if (f.untrusted) {
    return (
      <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <span className="font-semibold">Out of date — last updated {f.label}</span>
        <span>· {f.state === "updating" ? "retrying…" : "these numbers may not be current."}</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => q.refetch()} disabled={q.isFetching}>Retry</Button>
      </div>
    );
  }
  if (f.state === "updating") {
    return <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">Updating… (showing numbers from {f.label})</p>;
  }
  return null;
}
