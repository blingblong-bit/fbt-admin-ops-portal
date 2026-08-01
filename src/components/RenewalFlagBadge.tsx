import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Open renewal campaigns = the exact detection already used by the renewal SMS
 * engine (visits_used = total - 1, no balance owed, and a future booking beyond
 * the last visit on the current package). The cron auto-flips a campaign to
 * "renewed" once the client's package/visits reset, so the flag clears itself
 * the moment staff uses Renew Package.
 */
const OPEN_STATUSES = ["active", "yes", "manual_review"];

export function useRenewalFlaggedClientIds() {
  return useQuery({
    queryKey: ["renewal_flags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_campaigns")
        .select("client_id, status")
        .in("status", OPEN_STATUSES);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.client_id as string));
    },
    staleTime: 30_000,
  });
}

export function useIsRenewalFlagged(clientId: string | undefined) {
  const q = useRenewalFlaggedClientIds();
  return !!clientId && !!q.data?.has(clientId);
}

export function RenewalFlagBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Last visit on current package with a future booking — check if they need a new package."
      className={`inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 ${className}`}
    >
      🔄 Renewal Pending
    </span>
  );
}
