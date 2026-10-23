import type { RenewalForecastRow } from "@/lib/schedule.functions";

/**
 * Pure grouping of existing renewal-forecast rows for the Renewals page.
 * It never decides activation — a prepared renewal leaves "Scheduled" only
 * because the existing check-in/Square activation cleared it from the client.
 */
export type RenewalGroups = {
  needs: RenewalForecastRow[];
  scheduled: RenewalForecastRow[];
  attention: RenewalForecastRow[];
};

export function attentionReason(r: RenewalForecastRow): string | null {
  // Old note issues alone don't need attention; only an unreadable CURRENT position does.
  if (r.automation_usable === false) return "Current Square visit position is unclear";
  if (r.pre_renewed && r.no_upcoming) return "Prepared, but no upcoming appointment is booked";
  return null;
}

export function groupRenewals(rows: RenewalForecastRow[]): RenewalGroups {
  const g: RenewalGroups = { needs: [], scheduled: [], attention: [] };
  for (const r of rows) {
    if (attentionReason(r)) g.attention.push(r);
    else if (r.pre_renewed) g.scheduled.push(r);
    else if (!r.no_upcoming && r.upcoming_count > r.remaining) g.needs.push(r);
  }
  const byDate = (a: RenewalForecastRow, b: RenewalForecastRow) =>
    (a.first_uncovered_ymd ?? "").localeCompare(b.first_uncovered_ymd ?? "");
  g.needs.sort(byDate);
  g.scheduled.sort(byDate);
  return g;
}
