import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { packageReviewDismissals, DISMISS_ACTIVITY, UNDISMISS_ACTIVITY } from "@/lib/simple-package-review";
export { DISMISS_ACTIVITY, UNDISMISS_ACTIVITY } from "@/lib/simple-package-review";

/**
 * "First Visit — No Package Info, Needs Review".
 *
 * Clients whose first visit was just an assessment never got a real package
 * set up. They stay flagged until either (a) a real package is saved on the
 * record (visits > 0), or (b) staff dismisses them with "No package needed".
 *
 * Dismissal is stored as a client_activities row so it's auditable and needs
 * no schema change: the latest of `package_review_dismissed` /
 * `package_review_redo` wins.
 */

/** Set of client ids currently dismissed from the package-review group. */
export function usePackageReviewDismissedIds() {
  return useQuery({
    queryKey: ["package_review_dismissals"],
    queryFn: async () => {
      const rows: { client_id: string; activity_type: string; created_at: string }[] = [];
      for (let from = 0; ; from += 500) {
        const result = await supabase.from("client_activities").select("client_id, activity_type, created_at")
          .in("activity_type", [DISMISS_ACTIVITY, UNDISMISS_ACTIVITY]).order("created_at").order("id").range(from, from + 499);
        if (result.error) throw result.error;
        rows.push(...result.data ?? []);
        if ((result.data?.length ?? 0) < 500) break;
      }
      return packageReviewDismissals(rows);
    },
    staleTime: 30_000,
  });
}

export function PackageReviewBadge({ className = "", priceNeeded = false }: { className?: string; priceNeeded?: boolean }) {
  return (
    <span
      title={priceNeeded
        ? "Package was auto-created from Square visit notes — set the package price to finish."
        : "First visit was an assessment only — no package info on file. Set a real package or mark as not needed."}
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ${className}`}
    >
      {priceNeeded ? "💲 Price Needed" : "📝 Needs Package Review"}
    </span>
  );
}
