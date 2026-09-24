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
