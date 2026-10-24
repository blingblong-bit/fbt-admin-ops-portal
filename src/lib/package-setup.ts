// "Needs Package Setup": assessment clients awaiting a first package.
// Pure classification only — never creates packages, payments or texts.
// Staff "No package needed" dismissals keep their meaning elsewhere (out of
// Package Review / money states); this list only keeps them in follow-up.

export type SetupClient = {
  id: string;
  status?: string | null;
  deleted_at?: string | null;
  payment_model?: string | null;
  package_total_visits?: number | null;
  package_name?: string | null;
};

export type SetupBooking = { start_at: string; status?: string | null; seller_note?: string | null; customer_note?: string | null };

export type SetupState = "urgent" | "assessment_scheduled" | "follow_up";

export type SetupRow = {
  client_id: string;
  state: SetupState;
  last_visit_ymd: string | null;
  next_appointment_ymd: string | null;
  future_count: number;
  dismissed: boolean;
  reason: string;
};

const DEAD = /CANCEL|DECLINE|NO_SHOW/i;
const ASSESS = /assess|eval/i;
const ymd = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(iso));

/** A real package (visits > 0) on the effective (override-applied) record. */
export function hasPackage(c: SetupClient): boolean {
  return Number(c.package_total_visits ?? 0) > 0;
}

/**
 * In scope: active/assessment, package-model, no package, and either the
 * Hub "assessment" status or a staff "No package needed" dismissal.
 * Plain active clients without a package already live in Package Review.
 */
export function inSetupScope(c: SetupClient, dismissed: boolean): boolean {
  if (c.deleted_at || c.status === "archived") return false;
  if (c.payment_model === "pay_per_visit") return false;
  if (hasPackage(c)) return false;
  return c.status === "assessment" || dismissed;
}

export function classifySetup(c: SetupClient, dismissed: boolean, bookings: SetupBooking[], nowIso: string): SetupRow | null {
  if (!inSetupScope(c, dismissed)) return null;
  const live = bookings.filter((b) => b.start_at && !DEAD.test(b.status ?? "")).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = live.filter((b) => b.start_at < nowIso);
  const future = live.filter((b) => b.start_at >= nowIso);
  const last = past.at(-1)?.start_at ?? null;
  const next = future[0] ?? null;
  const base = {
    client_id: c.id, dismissed, future_count: future.length,
    last_visit_ymd: last ? ymd(last) : null, next_appointment_ymd: next ? ymd(next.start_at) : null,
  };
  if (next) {
    // Nothing done yet, or the next booking is itself marked as the assessment.
    const nextIsAssessment = past.length === 0 || ASSESS.test(`${next.seller_note ?? ""} ${next.customer_note ?? ""}`);
    if (nextIsAssessment) return { ...base, state: "assessment_scheduled", reason: "Assessment booked — set a package after it" };
    return { ...base, state: "urgent", reason: "Follow-up booked but no package on file" };
  }
  return { ...base, state: "follow_up", reason: last ? "Assessment done, no future appointment" : "No Square visit history" };
}

const RANK: Record<SetupState, number> = { urgent: 0, assessment_scheduled: 1, follow_up: 2 };

/** One row per client; urgent first (soonest appointment), then most recent assessment. */
export function sortSetupRows(rows: SetupRow[]): SetupRow[] {
  const seen = new Set<string>();
  const uniq = rows.filter((r) => (seen.has(r.client_id) ? false : (seen.add(r.client_id), true)));
  return uniq.sort((a, b) =>
    RANK[a.state] - RANK[b.state] ||
    (a.next_appointment_ymd ?? "9999").localeCompare(b.next_appointment_ymd ?? "9999") ||
    (b.last_visit_ymd ?? "").localeCompare(a.last_visit_ymd ?? ""));
}
