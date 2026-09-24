// Pure helpers for the read-only Square visit reconciliation audit.
// Nothing here writes anywhere.

export type ParsedNote = { n: number; total: number };

const RX = /(?:visit\s*#?\s*)?\b(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/gi;

/** Returns the visit notation, or null when missing or ambiguous. */
export function parseVisitNote(note: string | null | undefined): ParsedNote | null {
  if (!note) return null;
  const found = new Map<string, ParsedNote>();
  for (const m of note.matchAll(RX)) {
    const n = Number(m[1]);
    const total = Number(m[2]);
    // Skip things that look like dates (e.g. 9/24) — invalid positions.
    if (total < 1 || n < 1 || n > total || total > 40) continue;
    found.set(`${n}/${total}`, { n, total });
  }
  if (found.size !== 1) return null; // none, or conflicting notations
  return [...found.values()][0];
}

export type AuditBooking = {
  id: string;
  start_at: string;
  seller_note?: string | null;
  customer_note?: string | null;
};

export type ParsedBooking = {
  booking_id: string;
  date: string;
  past: boolean;
  n: number;
  total: number;
};

export type Classification = "Square synced" | "Hub fallback" | "Needs review";

export type AuditRow = {
  client_id: string;
  name: string;
  hub: string;
  latest_square: string | null;
  future: string[];
  classification: Classification;
  reason: string;
  pattern: string;
};

export function parseBookings(bookings: AuditBooking[], nowIso: string): ParsedBooking[] {
  const out: ParsedBooking[] = [];
  for (const b of bookings) {
    const p = parseVisitNote(b.seller_note) ?? parseVisitNote(b.customer_note);
    if (!p) continue;
    out.push({ booking_id: b.id, date: b.start_at, past: b.start_at < nowIso, ...p });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Index of the first sequence break (not n+1, and not a 1-of wrap after the last visit). */
function sequenceBreak(seq: ParsedBooking[]): string | null {
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1];
    const b = seq[i];
    if (a.date.slice(0, 10) === b.date.slice(0, 10) && (a.n !== b.n || a.total !== b.total) && b.n !== a.n + 1) {
      return `conflicting same-day notes ${a.n}/${a.total} and ${b.n}/${b.total}`;
    }
    const next = b.n === a.n + 1 && b.total === a.total;
    const wrap = a.n === a.total && b.n === 1;
    if (!next && !wrap) return `${a.n}/${a.total} → ${b.n}/${b.total}`;
  }
  return null;
}

export function classifyClient(
  hubUsed: number,
  hubTotal: number,
  parsed: ParsedBooking[],
): { classification: Classification; reason: string; pattern: string; latest: ParsedBooking | null } {
  const past = parsed.filter((p) => p.past);
  const future = parsed.filter((p) => !p.past);
  const latest = past[past.length - 1] ?? null;

  if (parsed.length === 0) {
    return { classification: "Hub fallback", reason: "No usable Square visit notes", pattern: "no_notes", latest };
  }
  if (parsed.length === 1) {
    return { classification: "Hub fallback", reason: "Only one isolated Square note", pattern: "isolated_note", latest };
  }

  // Check the most recent stretch (last 6 past + all future) for consistency.
  const recent = [...past.slice(-6), ...future];
  const br = sequenceBreak(recent);
  if (br) return { classification: "Needs review", reason: `Square sequence inconsistent: ${br}`, pattern: "sequence_break", latest };

  if (latest) {
    if (latest.total !== hubTotal) {
      // Latest is on a new package the Hub hasn't rolled over to? Allow 1-of wrap.
      return {
        classification: "Needs review",
        reason: `Package size differs — Hub ${hubTotal}, Square ${latest.total}`,
        pattern: "total_mismatch",
        latest,
      };
    }
    const diff = latest.n - hubUsed;
    if (diff === 0) return { classification: "Square synced", reason: "Latest Square visit matches Hub", pattern: "match", latest };
    // Appointment earlier today not yet checked in counts as 1 behind.
    return {
      classification: "Needs review",
      reason: diff > 0 ? `Square ahead by ${diff} visit${diff === 1 ? "" : "s"}` : `Hub ahead by ${-diff} visit${diff === -1 ? "" : "s"}`,
      pattern: diff > 0 ? (diff === 1 ? "square_ahead_1" : "square_ahead_2plus") : (diff === -1 ? "hub_ahead_1" : "hub_ahead_2plus"),
      latest,
    };
  }

  // Only future notes: first future should be the next visit.
  const f = future[0];
  const expected = hubUsed >= hubTotal ? 1 : hubUsed + 1;
  if (f.total !== hubTotal && !(hubUsed >= hubTotal && f.n === 1)) {
    return { classification: "Needs review", reason: `Package size differs — Hub ${hubTotal}, Square ${f.total}`, pattern: "total_mismatch", latest };
  }
  if (f.n === expected) return { classification: "Square synced", reason: "Next Square visit follows Hub", pattern: "match_future", latest };
  return { classification: "Needs review", reason: `Next Square visit ${f.n}/${f.total}, Hub expects ${expected}`, pattern: "future_mismatch", latest };
}

// ---------------------------------------------------------------------------
// Visit Note Review — detects internally inconsistent Square note sequences.
// Square is the source of truth; Hub counts are never compared here.
// ---------------------------------------------------------------------------

export type ReviewBooking = {
  id: string;
  start_at: string;
  status?: string | null;
  seller_note?: string | null;
  customer_note?: string | null;
};

export type NoteIssueKind =
  | "skipped"
  | "stale_future"
  | "backward"
  | "same_day_conflict"
  | "package_size"
  | "missing_note";

export type NoteIssue = { kind: NoteIssueKind; reason: string; expected: string | null; date: string };

export type SequenceEntry = {
  booking_id: string;
  date: string;
  past: boolean;
  note: ParsedNote | null;
};

export const ISSUE_LABELS: Record<NoteIssueKind, string> = {
  skipped: "Skipped visit number",
  stale_future: "Future numbering may be stale",
  backward: "Sequence goes backward",
  same_day_conflict: "Conflicting same-day notes",
  package_size: "Package size changed",
  missing_note: "Missing note in sequence",
};

const CANCELLED = /CANCELLED|CANCELED|DECLINED|NO_SHOW/i;
const PAST_WINDOW = 6;

export function buildSequence(bookings: ReviewBooking[], nowIso: string): SequenceEntry[] {
  return bookings
    .filter((b) => b.start_at && !CANCELLED.test(b.status ?? ""))
    .map((b) => ({
      booking_id: b.id,
      date: b.start_at,
      past: b.start_at < nowIso,
      note: parseVisitNote(b.seller_note) ?? parseVisitNote(b.customer_note),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const fmt = (n: ParsedNote) => `${n.n}/${n.total}`;

/** Returns issues found in the recent Square sequence (last 6 past noted visits + all future). */
export function detectNoteIssues(seq: SequenceEntry[]): NoteIssue[] {
  const notedIdx = seq.map((e, i) => (e.note ? i : -1)).filter((i) => i >= 0);
  if (notedIdx.length < 2) return []; // no/isolated notes → Hub fallback, no flag
  const pastNoted = notedIdx.filter((i) => seq[i].past);
  const startIdx = pastNoted.length > PAST_WINDOW ? pastNoted[pastNoted.length - PAST_WINDOW] : notedIdx[0];
  const window = notedIdx.filter((i) => i >= startIdx);

  const issues: NoteIssue[] = [];
  for (let k = 1; k < window.length; k++) {
    const ai = window[k - 1];
    const bi = window[k];
    const A = seq[ai];
    const B = seq[bi];
    const a = A.note!;
    const b = B.note!;
    const date = B.date;
    const sameDay = A.date.slice(0, 10) === B.date.slice(0, 10);
    const renewal = a.n === a.total && b.n === 1;
    const next = b.total === a.total && b.n === a.n + 1;

    if (sameDay && !next && !renewal) {
      issues.push({ kind: "same_day_conflict", reason: `Conflicting visit numbers on same day: ${fmt(a)} and ${fmt(b)}`, expected: null, date });
      continue;
    }
    if (next || renewal) continue;

    if (b.total !== a.total) {
      issues.push({ kind: "package_size", reason: `Package size changed unexpectedly: ${fmt(a)} → ${fmt(b)}`, expected: `${a.n + 1}/${a.total}`, date });
      continue;
    }
    const expected = `${a.n + 1}/${a.total}`;
    if (b.n <= a.n) {
      issues.push({ kind: "backward", reason: `Visit sequence goes backward: ${fmt(a)} → ${fmt(b)}`, expected, date });
      continue;
    }
    // Forward gap. Were there un-noted appointments in between?
    const gap = b.n - a.n - 1;
    const unnoted = seq.slice(ai + 1, bi).filter((e) => !e.note).length;
    if (unnoted > 0 && unnoted >= gap) {
      issues.push({ kind: "missing_note", reason: `Missing visit note inside package sequence: ${fmt(a)} → [no note] → ${fmt(b)}`, expected, date });
    } else if (A.past && !B.past) {
      issues.push({ kind: "stale_future", reason: `Future visit numbering may be stale — last past ${fmt(a)}, next ${fmt(b)}`, expected, date });
    } else {
      issues.push({ kind: "skipped", reason: `Possible skipped visit number: ${fmt(a)} → ${fmt(b)}`, expected, date });
    }
  }
  // A missing note inside an otherwise clear sequence (n → [none] → n+1 would be fine only if numbers skip).
  return issues;
}
