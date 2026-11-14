import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VisitTracking } from "@/lib/effective-visit-state";

/** Bulk read of the exact raw tracking inputs used by getClientVisitTracking. */
export const getClientListVisitTracking = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, VisitTracking>> => {
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return {};
    const { loadSquareBookingIndex, effectiveStateFor } = await import("@/lib/effective-visit-state.server");
    const { visitTrackingFrom } = await import("@/lib/effective-visit-state");
    const index = await loadSquareBookingIndex(token, 180, 60);
    if (index.error) throw new Error("Square visit progress could not load");
    const visits: Record<string, VisitTracking> = {};
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await context.supabase.from("clients")
        .select("id, visits_used, package_total_visits, square_customer_id, visit_tracking_mode")
        .not("square_customer_id", "is", null)
        .gt("package_total_visits", 0)
        .order("id")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      for (const client of data ?? []) {
        visits[client.id] = visitTrackingFrom(effectiveStateFor(index, client));
      }
      if ((data?.length ?? 0) < pageSize) break;
    }
    return visits;
  });