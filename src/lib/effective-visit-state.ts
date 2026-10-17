// Effective visit state — Square appointment notes drive visit position when
// Square's own sequence is coherent; stored Hub counts are fallback only.
// Pure: no I/O. Stored Hub history is never modified from here.

import {
  buildSequence,
  detectNoteIssues,
  isSupersededCancellation,
  isOutrankedCancellation,
  type NoteIssue,
  type ReviewBooking,
  type SequenceEntry,
} from "@/lib/square-visit-audit";

export type VisitSource = "square" | "hub_fallback";
export type ReviewStatus = "clean" | "needs_review";

export const SOURCE_LABELS: Record<VisitSource, string> = {
  square: "Square",
  hub_fallback: "Hub fallback",
};
export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  clean: "Clean",
  needs_review: "Needs review",
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
  /** ISO start of the past live 1/N that opened the current Square package after an N/N. */
  currentPackageStart: string | null;
  /** Warning only — Square numbering has an anomaly worth a look. Never overrides Square. */
  reviewStatus: ReviewStatus;
  /** False only when Square's current position genuinely can't be worked out. */
  automationUsable: boolean;
  /** Alias of !automationUsable: downstream must keep current known state and hold new decisions. */
  suppressed: boolean;
  issues: NoteIssue[];
  hubVisitsUsed: number | null;
  hubTotalVisits: number;
};

export type HubVisitClient = {
  visits_used: number | null;
  package_total_visits: number | null;
  /** Staff override: "auto" (default), "square" (trust Square notes), "hub" (manual check-ins). */
  visit_tracking_mode?: string | null;
};

/**
 * True only when the latest past numbered visit itself is contradictory:
 * conflicting numbers on that date, or it goes backward / changes size with
 * no N/N → 1/N renewal to explain it. Older anomalies are warnings only.
 */
export function currentPositionUnreadable(seq: SequenceEntry[], issues: NoteIssue[]): boolean {
  const pastNoted = seq.filter((e) => e.past && e.note && !isSupersededCancellation(seq, e) && !isOutrankedCancellation(seq, e));
  const latest = pastNoted[pastNoted.length - 1];
  if (!latest) return false;
  const day = latest.date.slice(0, 10);
  return issues.some((i) => {
    if (i.date.slice(0, 10) !== day) return false;
    return i.kind === "same_day_conflict" || i.kind === "backward" || i.kind === "package_size";
  });
}

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
  // A cancelled number that was rebooked on a live appointment was never used,
  // so it can't set the current position (e.g. cancelled 7/8 → rebooked 7/8).
  const pastNoted = past.filter((e) => e.note && !isSupersededCancellation(seq, e) && !isOutrankedCancellation(seq, e));
  const hubUsed = client.visits_used ?? null;
  const hubTotal = Number(client.package_total_visits ?? 0);

  const base = {
    upcoming: future.map(toVisit),
    recent: pastNoted.slice(-6).map(toVisit),
    issues,
    hubVisitsUsed: hubUsed,
    hubTotalVisits: hubTotal,
  };

  const reviewStatus: ReviewStatus = issues.length > 0 ? "needs_review" : "clean";
  const hubState = (source: VisitSource, reason: string, usable = true): EffectiveVisitState => {
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
      currentPackageStart: null,
      reviewStatus,
      automationUsable: usable,
      suppressed: !usable,
    };
  };

  const override = client.visit_tracking_mode ?? "auto";
  if (override === "hub") return hubState("hub_fallback", "Staff chose Hub manual check-ins for this client");
  const forceSquare = override === "square";

  if (currentPositionUnreadable(seq, issues)) {
    return hubState("hub_fallback", `Current Square position unreadable — ${issues.map((i) => i.reason).join("; ")}`, false);
  }
  if (noted.length === 0) return hubState("hub_fallback", "No usable Square visit notes");
  // A lone "1 of N" is a clear package start; staff can also force Square.
  if (noted.length === 1 && !forceSquare && noted[0].note!.n !== 1) {
    return hubState("hub_fallback", "Only one isolated Square note");
  }

  const latest = pastNoted[pastNoted.length - 1] ?? null;
  let used: number;
  let total: number;
  let reason: string;
  if (latest) {
    used = latest.note!.n;
    total = latest.note!.total;
    reason = `Latest past Square visit ${fmt(latest)}`;
    if (issues.length > 0) reason += ` (flagged: ${issues.map((i) => i.reason).join("; ")})`;
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

  // Past boundary: latest live 1/N whose previous relevant numbered entry is a completed N/N.
  let currentPackageStart: string | null = null;
  const rel = pastNoted.filter((e) => !e.cancelled);
  for (let i = rel.length - 1; i >= 1; i--) {
    const a = rel[i - 1].note!, b = rel[i].note!;
    if (b.n === 1 && a.n === a.total) { currentPackageStart = rel[i].date; break; }
  }

  return {
    ...base,
    source: "square",
    currentPackageStart,
    visitsUsed: used,
    totalVisits: total,
    latestVisitBookingId: latest?.booking_id ?? null,
    latestVisitDate: latest?.date ?? null,
    latestVisitNote: latest ? fmt(latest) : null,
    nextVisitNumber: complete ? 1 : used + 1,
    remainingVisits: Math.max(0, total - used),
    reason,
    nextPackageStart,
    reviewStatus,
    automationUsable: true,
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
 * Square (clean or flagged) → Square state. Hub fallback → Hub; when the
 * fallback was forced by an unreadable Square position, suppressed=true holds new decisions.
 */
export function drivingCounts(s: EffectiveVisitState): { used: number; total: number; nextPackageStart: string | null; currentPackageStart: string | null } {
  if (s.source === "square") return { used: s.visitsUsed, total: s.totalVisits, nextPackageStart: s.nextPackageStart, currentPackageStart: s.currentPackageStart };
  return { used: Number(s.hubVisitsUsed ?? 0), total: s.hubTotalVisits, nextPackageStart: null, currentPackageStart: null };
}

// ---------------------------------------------------------------------------
// Check-in presentation (pure): does Hub need a manual check-in for this client?
// ---------------------------------------------------------------------------

export type VisitTrackingMode = "square" | "square_review" | "hub_fallback" | "held";

export type VisitTracking = {
  mode: VisitTrackingMode;
  used: number;
  total: number;
  lastVisitDate: string | null;
  nextNote: string | null;
  nextDate: string | null;
  /** True only when Hub genuinely has to track visits itself. */
  manualCheckInNeeded: boolean;
  reason: string;
};

export function visitTrackingFrom(s: EffectiveVisitState): VisitTracking {
  const mode: VisitTrackingMode = !s.automationUsable
    ? "held"
    : s.source === "hub_fallback"
      ? "hub_fallback"
      : s.reviewStatus === "needs_review"
        ? "square_review"
        : "square";
  const next = s.upcoming.find((u) => u.note && !u.cancelled) ?? null;
  const d = drivingCounts(s);
  return {
    mode,
    used: d.used,
    total: d.total,
    lastVisitDate: s.latestVisitDate,
    nextNote: next?.note ?? null,
    nextDate: next?.date ?? null,
    manualCheckInNeeded: mode === "hub_fallback" || mode === "held",
    reason: s.reason,
  };
}

/** A past, unrecorded appointment counts as a missed Hub check-in only when Hub tracks this client. */
export function countsAsMissedCheckIn(v: VisitTracking | null | undefined): boolean {
  return !v || v.manualCheckInNeeded;
}

/**
 * True when the Hub's current package was already renewed ahead of time: it
 * starts on/after the first uncovered appointment and has no visits used yet.
 * That package already covers those appointments, so no next package is due.
 */
export function currentPackageAlreadyCovers(
  packageStartYmd: string | null | undefined,
  hubVisitsUsed: number | null | undefined,
  firstUncoveredYmd: string,
): boolean {
  return !!packageStartYmd && Number(hubVisitsUsed ?? 0) === 0 && packageStartYmd >= firstUncoveredYmd;
}

/**
 * Start a prepared package on this check-in? The stored date is only the
 * earliest eligible start — it never activates on its own. Activation needs
 * reliable evidence: Square marks this visit 1/N, or the current package is
 * provably used up (Square position, or a reliable Hub count when Square has
 * no numbering). A missing number or failed lookup alone never activates.
 */
export type ActivationNote =
  | { status: "numbered"; n: number; total: number }
  | { status: "unnumbered" }
  | { status: "lookup_failed" };
export type PackageEvidence =
  /** Square-derived position for the client (null = could not be loaded). */
  | { source: "square"; used: number; total: number }
  | { source: "hub_fallback" }
  | { source: "review" }
  | null;
export type ActivationDecision =
  | { action: "not_eligible" }
  | { action: "activate"; reason: string }
  | { action: "count_current"; reason: string }
  | { action: "hold"; consumeVisit: false; reason: string };

export function decidePreparedActivation(i: {
  visitYmd: string;
  preparedStartYmd: string;
  note: ActivationNote;
  hubUsed: number;
  hubTotal: number;
  evidence: PackageEvidence;
}): ActivationDecision {
  if (i.visitYmd < i.preparedStartYmd) return { action: "not_eligible" };
  const hubFull = i.hubTotal > 0 && i.hubUsed >= i.hubTotal;
  if (i.note.status === "numbered") {
    if (i.note.n === 1) return { action: "activate", reason: "Square marks this visit 1/N" };
    if (!hubFull) return { action: "count_current", reason: `Square marks this visit ${i.note.n}/${i.note.total} of the current package` };
    return { action: "hold", consumeVisit: false, reason: `Square marks this visit ${i.note.n}/${i.note.total} but Hub shows the package used up` };
  }
  const ev = i.evidence;
  if (ev?.source === "square" && ev.total > 0 && ev.used >= ev.total)
    return { action: "activate", reason: "Square shows the current package is used up" };
  if (i.note.status === "unnumbered" && ev?.source === "hub_fallback" && hubFull)
    return { action: "activate", reason: "No Square numbering; reliable Hub count shows the package used up" };
  const why = i.note.status === "lookup_failed" ? "Square lookup failed" : "Square visit number missing";
  if (!hubFull && !(ev?.source === "square" && ev.used >= ev.total))
    return { action: "count_current", reason: `${why}; current package still has visits left` };
  return { action: "hold", consumeVisit: false, reason: `${why}; package may be used up but evidence is unreliable` };
}

export type PackageAutofill = {
  totalVisits: number;
  visitsUsed: number;
  startDate: string; // YYYY-MM-DD of the package opener (1/N)
  packageName: string;
  /** True when Square history starts mid-package (no 1/N seen). */
  startEstimated: boolean;
};

/**
 * Derive package details for a client whose Hub record has NO package info,
 * from their Square booking notes alone. Returns null unless Square shows a
 * coherent, review-clean numbered sequence — isolated or contradictory notes
 * are never guessed into a package.
 *
 * Used to auto-create the package shell (visits + start date); the price is
 * always left for staff to fill in.
 */
export function packageAutofillFromBookings(
  bookings: ReviewBooking[],
  nowIso: string,
): PackageAutofill | null {
  const seq = buildSequence(bookings, nowIso);
  const noted = seq.filter((e) => e.note !== null && !isSupersededCancellation(seq, e));
  if (noted.length === 0) return null;

  // Only current packages: a numbered visit in the last 60 days or upcoming.
  const cutoff = new Date(new Date(nowIso).getTime() - 60 * 864e5).toISOString();
  if (!noted.some((e) => !e.past || e.date >= cutoff)) return null;

  const state = resolveEffectiveVisitState({ visits_used: null, package_total_visits: 0 }, bookings, nowIso);
  if (state.source !== "square" || !state.automationUsable || state.totalVisits <= 0) {
    // Lone clear "n of N" note: the resolver treats it as isolated, but for a
    // client with NO package it's still the best evidence we have.
    if (noted.length !== 1 || state.issues.length > 0) return null;
    const only = noted[0];
    const { n, total } = only.note!;
    if (!(total > 0 && n >= 1 && n <= total)) return null;
    return {
      totalVisits: total,
      visitsUsed: only.past ? n : n - 1,
      startDate: only.date.slice(0, 10),
      packageName: `${total}-Visit Package`,
      startEstimated: n !== 1,
    };
  }


  const pastNoted = noted.filter((e) => e.past);
  const futureNoted = noted.filter((e) => !e.past);

  let startEntry: SequenceEntry | undefined;
  if (pastNoted.length > 0) {
    // Most recent package opener (1/N) at or before the latest past visit.
    for (let i = pastNoted.length - 1; i >= 0; i--) {
      if (pastNoted[i].note!.n === 1) { startEntry = pastNoted[i]; break; }
    }
    // No opener found (history starts mid-package): anchor on the earliest
    // known visit rather than guessing an earlier date.
    if (!startEntry) startEntry = pastNoted[0];
  } else {
    // Package hasn't started yet: use the upcoming 1/N.
    startEntry = futureNoted.find((e) => e.note!.n === 1) ?? futureNoted[0];
  }
  if (!startEntry) return null;

  return {
    totalVisits: state.totalVisits,
    visitsUsed: state.visitsUsed,
    startDate: startEntry.date.slice(0, 10),
    packageName: `${state.totalVisits}-Visit Package`,
    startEstimated: startEntry.note!.n !== 1,
  };
}
