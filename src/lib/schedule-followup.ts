// Pure Schedule Check follow-up rules. Read-only: never changes counters.
import type { VisitTracking } from "@/lib/effective-visit-state";
import { addDaysYmd, workWeekStartFromYmd } from "@/lib/work-week";

export type FollowUpClient = {
  id: string;
  status: string | null;
  package_total_visits: number;
  visits_used: number | null;
  pending_renewal_start_date?: string | null;
  visit?: VisitTracking | null;
};

export type Remaining = {
  /** Visits left shown to staff. */
  left: number;
  /** Non-null when Hub and Square disagree or Square can't be trusted. */
  check: string | null;
};

const hubLeft = (c: FollowUpClient) =>
  c.visits_used === null || c.visits_used === undefined
    ? Math.max(0, c.package_total_visits ?? 0)
    : Math.max(0, (c.package_total_visits ?? 0) - c.visits_used);

/**
 * Effective visits left. Square notes win when they're clean; when they're
 * flagged/held we keep Hub's number but never hide the client because of a
 * stale Hub count — a disagreement is surfaced as a check, not a decision.
 */
export function effectiveRemaining(c: FollowUpClient): Remaining {
  const hub = hubLeft(c);
  const v = c.visit;
  if (!v || v.mode === "hub_fallback" || !(v.total > 0)) return { left: hub, check: null };
  const sq = Math.max(0, v.total - v.used);
  if (v.mode === "square") {
    const check = sq !== hub ? `Hub shows ${hub} left, Square notes show ${sq} left` : null;
    return { left: sq, check };
  }
  // square_review / held: Square position is uncertain — don't invent a count.
  if (sq === hub) return { left: hub, check: null };
  return { left: Math.max(hub, sq), check: `Visit count unclear — Hub ${hub} left, Square ${sq} left` };
}

/** Eligible for scheduling follow-up: real, non-archived client with visits left (or a prepared next package). */
export function followUpEligible(c: FollowUpClient): boolean {
  if (c.status === "archived" || c.status === "inactive") return false;
  if (!((c.package_total_visits ?? 0) > 0)) return false;
  const r = effectiveRemaining(c);
  return r.left > 0 || !!r.check || !!c.pending_renewal_start_date;
}

export type FollowUpAppt = { client_id: string; day: string /* Chicago YYYY-MM-DD */ };

export type FollowUpGroups = {
  /** Last live visit fell in the previous work week; nothing booked since. */
  last_week_nothing_booked: string[];
  /** Everyone else with nothing booked after the selected date. */
  not_scheduled_after: string[];
};

/**
 * Groups are disjoint. `appts` must already exclude cancelled/no-show/declined.
 * Clients with a this-week appointment are left to "This Week But Not Next".
 */
export function groupFollowUps(
  clients: FollowUpClient[],
  appts: FollowUpAppt[],
  selectedYmd: string,
): FollowUpGroups {
  const weekStart = workWeekStartFromYmd(selectedYmd);
  const prevWeekStart = addDaysYmd(weekStart, -7);
  const last = new Map<string, string>();
  const after = new Set<string>();
  for (const a of appts) {
    if (a.day > selectedYmd) after.add(a.client_id);
    const p = last.get(a.client_id);
    if (!p || a.day > p) last.set(a.client_id, a.day);
  }
  const out: FollowUpGroups = { last_week_nothing_booked: [], not_scheduled_after: [] };
  for (const c of clients) {
    if (!followUpEligible(c) || after.has(c.id)) continue;
    const l = last.get(c.id);
    if (l && workWeekStartFromYmd(l) === prevWeekStart) out.last_week_nothing_booked.push(c.id);
    else out.not_scheduled_after.push(c.id);
  }
  return out;
}
