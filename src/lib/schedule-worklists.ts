// Pure Schedule Check worklist rules. Read-only: never changes counters,
// packages, payments or appointments. Priority: Package Completed >
// Not Scheduled > Only Once This Week; Hidden is separate. Each client lands
// in at most one list.
import { effectiveRemaining, type FollowUpClient } from "@/lib/schedule-followup";
import { addDaysYmd } from "@/lib/work-week";

export const RECENT_DAYS = 60;

export type WorklistClient = FollowUpClient & {
  package_start_date?: string | null;
};

export type ManualHide = {
  id: string;
  hidden_at: string;
  reason: string | null;
  known_future_booking_ids: string[];
  package_start_snapshot: string | null;
  pending_renewal_snapshot: string | null;
  /** "hide" = staff hid; "pin" = staff restored an auto-hidden client. */
  kind?: "hide" | "pin";
};

export type ClientScheduleFacts = {
  /** Chicago YMD of the latest past kept (not cancelled/no-show/declined) visit. */
  lastKeptYmd: string | null;
  /** IDs of live (not cancelled/no-show/declined) bookings starting now or later. */
  futureLiveIds: string[];
  /** Live appointments in the selected work week (past or future). */
  thisWeekLiveCount: number;
  /** Not linked to Square: missing history is not evidence of inactivity. */
  sourceUnknown?: boolean;
};

export type WorklistKey = "package_completed" | "not_scheduled" | "only_once" | "hidden" | null;

export type WorklistResult = {
  list: WorklistKey;
  reasons: string[];
  hiddenKind?: "manual" | "auto";
  /** Set when a manual hide should be cleared (new booking / new package). */
  clearHide?: string;
  /** Set when a staff restore (pin) should be cleared by new activity. */
  clearPin?: string;
  /** Shown only because staff restored an auto-hidden client. */
  pinned?: boolean;
  left: number;
  check: string | null;
};

/** Manual hide is cleared only by genuinely NEW activity since it was set. */
export function hideReactivation(c: WorklistClient, f: ClientScheduleFacts, h: ManualHide): string | null {
  const known = new Set(h.known_future_booking_ids);
  if (f.futureLiveIds.some((id) => !known.has(id))) return "New appointment booked";
  const ps = c.package_start_date ?? null;
  if (ps && (!h.package_start_snapshot || ps > h.package_start_snapshot)) return "New package started";
  const pr = c.pending_renewal_start_date ?? null;
  if (pr && pr !== h.pending_renewal_snapshot) return "New package purchased";
  return null;
}

export function classifyWorklist(
  c: WorklistClient,
  f: ClientScheduleFacts,
  todayYmd: string,
  hide: ManualHide | null,
): WorklistResult {
  const r = effectiveRemaining(c);
  const base = { left: r.left, check: r.check };
  if (c.status === "archived" || c.status === "inactive" || !((c.package_total_visits ?? 0) > 0)) {
    return { list: null, reasons: [], ...base };
  }
  const cutoff = addDaysYmd(todayYmd, -RECENT_DAYS);
  const recentVisit = !!f.lastKeptYmd && f.lastKeptYmd >= cutoff;
  const recentPackage =
    (!!c.package_start_date && c.package_start_date >= cutoff) || !!c.pending_renewal_start_date;
  const hasFuture = f.futureLiveIds.length > 0;
  const reasons: string[] = [];
  if (r.check) reasons.push(r.check);

  const pin = hide?.kind === "pin" ? hide : null;
  if (pin) hide = null;
  const clearPin = pin ? (hideReactivation(c, f, pin) ?? undefined) : undefined;
  const clearHide = hide ? (hideReactivation(c, f, hide) ?? undefined) : undefined;
  if (hide && !clearHide) {
    // Mismatched counts are never hidden — flag for review instead.
    if (!r.check) return { list: "hidden", hiddenKind: "manual", reasons: [hide.reason || "Hidden by staff"], ...base };
    reasons.push("Hidden by staff, but visit count needs review");
  }
  if (clearPin) reasons.push(`Restore no longer needed: ${clearPin}`);
  if (clearHide) reasons.push(`Unhidden: ${clearHide}`);

  const completed = r.left === 0 && !r.check && !c.pending_renewal_start_date;
  if (completed && (recentVisit || recentPackage)) {
    reasons.unshift(hasFuture ? "Package used up — has a booking, needs renewal review" : "Package used up — needs rescheduling or review");
    return { list: "package_completed", reasons, clearHide, clearPin, ...base };
  }
  if (!hasFuture) {
    if (pin && !clearPin) {
      reasons.unshift("Restored by staff (stays until new activity or hidden again)");
      return { list: "not_scheduled", reasons, pinned: true, ...base };
    }
    if (f.sourceUnknown && !recentPackage && !r.check) {
      reasons.unshift("Not linked to Square — can't confirm last visit; check before hiding");
      return { list: "not_scheduled", reasons, clearHide, clearPin, ...base };
    }
    if (recentVisit || recentPackage || r.check) {
      reasons.unshift(
        recentVisit ? `Last visit ${f.lastKeptYmd}; nothing booked` : recentPackage ? "New package; nothing booked" : "No booking; visit count needs review",
      );
      return { list: "not_scheduled", reasons, clearHide, clearPin, ...base };
    }
    return {
      list: "hidden",
      hiddenKind: "auto",
      reasons: [f.lastKeptYmd ? `Last seen ${f.lastKeptYmd} (over ${RECENT_DAYS} days)` : `No visit in last ${RECENT_DAYS} days`],
      clearHide,
      clearPin,
      ...base,
    };
  }
  if (f.thisWeekLiveCount === 1) {
    reasons.unshift("Only one appointment this week");
    return { list: "only_once", reasons, clearHide, clearPin, ...base };
  }
  return { list: null, reasons, clearHide, clearPin, ...base };
}
