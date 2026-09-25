// Effective visit state — Square appointment notes drive visit position when
// Square's own sequence is coherent; stored Hub counts are fallback only.
// Pure: no I/O. Stored Hub history is never modified from here.

import {
  buildSequence,
  detectNoteIssues,
  type NoteIssue,
  type ReviewBooking,
  type SequenceEntry,
} from "@/lib/square-visit-audit";

export type VisitSource = "square" | "hub_fallback" | "review_required";

export const SOURCE_LABELS: Record<VisitSource, string> = {
  square: "Square synced",
  hub_fallback: "Hub fallback",
  review_required: "Review required",
};

export type UpcomingVisit = {
  booking_id: string;
  date: string;
  note: string | null;
  cancelled: boolean;
  status: string | null;
};

export type EffectiveVisitState = {
  source: VisitSource;
  visitsUsed: number;
  totalVisits: number;
  latestVisitBookingId: string | null;
  latestVisitDate: string | null;
  latestVisitNote: string | null;
  nextVisitNumber: number;
  remainingVisits: number;
  reason: string;
  /** Upcoming appointments (all statuses) in date order. */
  upcoming: UpcomingVisit[];
  /** Recent past numbered appointments (up to 6). */
  recent: UpcomingVisit[];
  /** ISO start of the first future 1/N (not cancelled) after a completed package, when Square shows it. */
  nextPackageStart: string | null;
  /** Review required: downstream must keep current known state and hold new decisions. */
  suppressed: boolean;
  issues: NoteIssue[];
  hubVisitsUsed: number | null;
  hubTotalVisits: number;
};

export type HubVisitClient = {
  visits_used: number | null;
  package_total_visits: number | null;
};

const fmt = (e: SequenceEntry) => (e.note ? `${e.note.n}/${e.note.total}` : null);
const toVisit = (e: SequenceEntry): UpcomingVisit => ({
  booking_id: e.booking_id,
  date: e.date,
  note: fmt(e),
  cancelled: !!e.cancelled,
  status: e.status ?? null,
});

export function resolveEffectiveVisitState(
  client: HubVisitClient,
  bookings: ReviewBooking[],
  nowIso: string,
): EffectiveVisitState {
  const seq = buildSequence(bookings, nowIso);
  const issues = detectNoteIssues(seq);
  const noted = seq.filter((e) => e.note);
  const past = seq.filter((e) => e.past);
  const future = seq.filter((e) => !e.past);
  const pastNoted = past.filter((e) => e.note);
  const hubUsed = client.visits_used ?? null;
  const hubTotal = Number(client.package_total_visits ?? 0);

  const base = {
    upcoming: future.map(toVisit),
    recent: pastNoted.slice(-6).map(toVisit),
    issues,
    hubVisitsUsed: hubUsed,
    hubTotalVisits: hubTotal,
  };

  const hubState = (source: VisitSource, reason: string): EffectiveVisitState => {
    const used = Number(hubUsed ?? 0);
    return {
      ...base,
      source,
      visitsUsed: used,
      totalVisits: hubTotal,
      latestVisitBookingId: null,
      latestVisitDate: null,
      latestVisitNote: null,
      nextVisitNumber: hubTotal > 0 && used >= hubTotal ? 1 : used + 1,
      remainingVisits: Math.max(0, hubTotal - used),
      reason,
      nextPackageStart: null,
      suppressed: source === "review_required",
    };
  };

  if (issues.length > 0) {
    return hubState("review_required", issues.map((i) => i.reason).join("; "));
  }
  if (noted.length === 0) return hubState("hub_fallback", "No usable Square visit notes");
  if (noted.length === 1) return hubState("hub_fallback", "Only one isolated Square note");

  const latest = pastNoted[pastNoted.length - 1] ?? null;
  let used: number;
  let total: number;
  let reason: string;
  if (latest) {
    used = latest.note!.n;
    total = latest.note!.total;
    reason = `Latest past Square visit ${fmt(latest)}`;
  } else {
    // Only future notes: the first future note is the next visit.
    const first = noted[0].note!;
    used = first.n - 1;
    total = first.total;
    reason = `Next Square visit ${first.n}/${first.total} (no past notes yet)`;
  }

  const complete = used >= total;
  let nextPackageStart: string | null = null;
  const futureNoted = future.filter((e) => e.note && !e.cancelled);
  if (complete) {
    const f = futureNoted.find((e) => e.note!.n === 1);
    if (f) nextPackageStart = f.date;
  } else {
    // A future 1/N that follows an N/N in the future sequence marks the boundary.
    for (let i = 1; i < futureNoted.length; i++) {
      const a = futureNoted[i - 1].note!;
      const b = futureNoted[i].note!;
      if (a.n === a.total && b.n === 1) {
        nextPackageStart = futureNoted[i].date;
        break;
      }
    }
  }

  return {
    ...base,
    source: "square",
    visitsUsed: used,
    totalVisits: total,
    latestVisitBookingId: latest?.booking_id ?? null,
    latestVisitDate: latest?.date ?? null,
    latestVisitNote: latest ? fmt(latest) : null,
    nextVisitNumber: complete ? 1 : used + 1,
    remainingVisits: Math.max(0, total - used),
    reason,
    nextPackageStart,
    suppressed: false,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Renewal forecast from effective state (pure, testable)
// ---------------------------------------------------------------------------

export type ForecastInput = {
  /** Upcoming, non-cancelled appointment start ISO strings, sorted. */
  upcomingStarts: string[];
  visitsUsed: number;
  totalVisits: number;
  /** Square-shown next package start (ISO), preferred when present. */
  nextPackageStart: string | null;
};

export type ForecastResult = {
  needsRenewal: boolean;
  remaining: number;
  firstUncoveredIndex: number;
  firstUncoveredStart: string | null;
};

/** remaining = total − used; the first appointment beyond it starts the next package. */
export function forecastRenewal(i: ForecastInput): ForecastResult {
  const remaining = Math.max(0, i.totalVisits - i.visitsUsed);
  if (i.nextPackageStart) {
    const idx = i.upcomingStarts.indexOf(i.nextPackageStart);
    return {
      needsRenewal: true,
      remaining,
      firstUncoveredIndex: idx >= 0 ? idx : remaining,
      firstUncoveredStart: i.nextPackageStart,
    };
  }
  if (i.upcomingStarts.length <= remaining) {
    return { needsRenewal: false, remaining, firstUncoveredIndex: remaining, firstUncoveredStart: null };
  }
  return {
    needsRenewal: true,
    remaining,
    firstUncoveredIndex: remaining,
    firstUncoveredStart: i.upcomingStarts[remaining],
  };
}

/**
 * Chooses the state that drives downstream decisions.
 * Square → Square state. Hub fallback → Hub. Review required → Hub (current
 * known behaviour) with suppressed=true so any Square-implied change is held.
 */
export function drivingCounts(s: EffectiveVisitState): { used: number; total: number; nextPackageStart: string | null } {
  if (s.source === "square") return { used: s.visitsUsed, total: s.totalVisits, nextPackageStart: s.nextPackageStart };
  return { used: Number(s.hubVisitsUsed ?? 0), total: s.hubTotalVisits, nextPackageStart: null };
}
