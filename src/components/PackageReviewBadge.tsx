import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
export const DISMISS_ACTIVITY = "package_review_dismissed";
export const UNDISMISS_ACTIVITY = "package_review_redo";

/** Set of client ids currently dismissed from the package-review group. */
export function usePackageReviewDismissedIds() {
  return useQuery({
    queryKey: ["package_review_dismissals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_activities")
        .select("client_id, activity_type, created_at")
        .in("activity_type", [DISMISS_ACTIVITY, UNDISMISS_ACTIVITY])
        .order("created_at", { ascending: true });
      if (error) throw error;
      const latest = new Map<string, string>();
      for (const r of data ?? []) {
        latest.set(r.client_id as string, r.activity_type as string);
      }
      const dismissed = new Set<string>();
      for (const [id, type] of latest) {
        if (type === DISMISS_ACTIVITY) dismissed.add(id);
      }
      return dismissed;
    },
    staleTime: 30_000,
  });
}

export function PackageReviewBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="First visit was an assessment only — no package info on file. Set a real package or mark as not needed."
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ${className}`}
    >
      📝 Needs Package Review
    </span>
  );
}
