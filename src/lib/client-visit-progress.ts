import { progress, type Client } from "@/lib/clients";
import type { VisitTracking } from "@/lib/effective-visit-state";

/** Same presentation rule as the profile; never updates package or billing state. */
export function clientVisitProgress(
  client: Pick<Client, "visits_used" | "package_total_visits">,
  visit: VisitTracking | null | undefined,
): string {
  return visit && !visit.manualCheckInNeeded
    ? progress({ visits_used: visit.used, package_total_visits: visit.total })
    : progress(client);
}