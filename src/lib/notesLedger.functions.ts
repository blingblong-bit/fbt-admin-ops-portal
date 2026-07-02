import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildLedgerRowFingerprint,
  normalizeLedgerText,
  parseLedger,
  normName,
  type ParsedRow,
} from "./notesLedger";

export type MatchClient = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  square_customer_id: string | null;
  status: string;
  package_price: number;
  package_total_visits: number;
  package_start_date: string | null;
  amount_paid: number;
  internal_notes: string | null;
};

export type RowDiagnostic = {
  line_number: number;
  parsed_name: string | null;
  parsed_phone: string | null;
  parsed_package_price: number | null;
  parsed_package_date: string | null;
  parsed_visits: number | null;
  parsed_amount_paid: number | null;
  phone_match_count: number;
  name_match_count: number;
  combined_unique_count: number;
  square_linked_count: number;
  outcome: "auto_update" | "review" | "skipped_no_changes" | "skipped_prior_resolution" | "parser_review";
  rule: string;
  reason: string;
};

export type DiagnosticSummary = {
  parser_needs_review: number;
  no_match: number;
  multiple_phone_matches: number;
  multiple_name_matches: number;
  multiple_square_linked: number;
  ambiguous_no_square_winner: number;
  no_changes_vs_current: number;
  auto_updates: number;
};

export type ReviewCategory =
  | "duplicate_ledger_entry"
  | "multiple_square_linked"
  | "missing_package_information"
  | "amount_only_package"
  | "leading_amount_mismatch"
  | "payments_exceed_package"
  | "missing_phone"
  | "credit_special_balance"
  | "multiple_names_on_line"
  | "no_match"
  | "ambiguous_match"
  | "other";



export type ReviewRow = ParsedRow & {
  candidates: MatchClient[];
  archived_candidates: MatchClient[];
  reason: string;
  categories: ReviewCategory[];
  note_status: NoteStatus;
  resolution: LedgerResolutionState;
};

export type NoteStatus = "append" | "already_exists" | "no_note";
export type LedgerResolutionStatus = "imported" | "skipped" | "resolved";

export type LedgerResolutionState =
  | { state: "unresolved" }
  | {
      state: "previously_resolved";
      status: LedgerResolutionStatus;
      resolved_at: string | null;
      reason: string | null;
      resolved_client_id: string | null;
    };

export type LedgerResolutionInput = {
  row_fingerprint: string;
  line_number: number;
  raw: string;
  name: string | null;
  phone: string | null;
  leading_amount: number | null;
  package_price: number | null;
  package_total_visits: number | null;
  package_start_date: string | null;
  internal_notes: string | null;
};

type StoredLedgerResolution = {
  row_fingerprint: string;
  resolution_status: LedgerResolutionStatus;
  resolved_at: string | null;
  reason: string | null;
  resolved_client_id: string | null;
};

function normalizeRowContent(raw: string): string {
  return normalizeLedgerText(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

function resolutionInputFromParsed(row: ParsedRow): LedgerResolutionInput {
  const fingerprint = row.row_fingerprint || buildLedgerRowFingerprint(row);
  return {
    row_fingerprint: fingerprint,
    line_number: row.line_number,
    raw: row.raw,
    name: row.name ?? null,
    phone: row.phone ?? null,
    leading_amount: row.leading_amount ?? null,
    package_price: row.package_price ?? null,
    package_total_visits: row.package_total_visits ?? null,
    package_start_date: row.package_start_date ?? null,
    internal_notes: row.internal_notes ?? null,
  };
}

function resolutionStateFor(
  row: ParsedRow,
  resolvedByFingerprint: Map<string, StoredLedgerResolution>,
): LedgerResolutionState {
  const hit = resolvedByFingerprint.get(row.row_fingerprint || buildLedgerRowFingerprint(row));
  if (!hit) return { state: "unresolved" };
  return {
    state: "previously_resolved",
    status: hit.resolution_status,
    resolved_at: hit.resolved_at,
    reason: hit.reason,
    resolved_client_id: hit.resolved_client_id,
  };
}

async function loadResolvedFingerprints(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  fingerprints: string[],
): Promise<Map<string, StoredLedgerResolution>> {
  const unique = Array.from(new Set(fingerprints.filter(Boolean)));
  const out = new Map<string, StoredLedgerResolution>();
  if (unique.length === 0) return out;
  const pageSize = 500;
  for (let i = 0; i < unique.length; i += pageSize) {
    const chunk = unique.slice(i, i + pageSize);
    const { data, error } = await supabase
      .from("notes_ledger_resolutions")
      .select("row_fingerprint, resolution_status, resolved_at, reason, resolved_client_id")
      .in("row_fingerprint", chunk);
    if (error) throw error;
    for (const r of (data ?? []) as StoredLedgerResolution[]) {
      out.set(r.row_fingerprint, r);
    }
  }
  return out;
}

async function persistLedgerResolution(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  row: LedgerResolutionInput,
  status: LedgerResolutionStatus,
  reason: string,
  clientId: string | null,
) {
  const { error } = await supabase.from("notes_ledger_resolutions").upsert(
    {
      row_fingerprint: row.row_fingerprint,
      resolution_status: status,
      resolved_client_id: clientId,
      line_number: row.line_number,
      raw_row: row.raw,
      normalized_row_content: normalizeRowContent(row.raw),
      parsed_name: row.name,
      parsed_phone: row.phone,
      leading_amount: row.leading_amount,
      package_price: row.package_price,
      package_total_visits: row.package_total_visits,
      package_start_date: row.package_start_date,
      internal_notes: row.internal_notes,
      reason,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    },
    { onConflict: "row_fingerprint" },
  );
  if (error) throw error;
}

export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  duplicate_ledger_entry: "Duplicate ledger entry",
  multiple_square_linked: "Multiple Square-linked clients",
  missing_package_information: "Missing package information",
  amount_only_package: "Amount-only package / special billing",
  leading_amount_mismatch: "Leading amount differs from package amount",

  missing_phone: "Missing phone",
  credit_special_balance: "Credit / special balance",
  multiple_names_on_line: "Multiple names on one line",
  no_match: "No match found",
  ambiguous_match: "Ambiguous match",
  other: "Other",
};

function classifyReview(
  row: ParsedRow,
  reason: string,
  squareLinkedCount: number,
  combinedCount: number,
  isDuplicate: boolean,
): ReviewCategory[] {
  const cats = new Set<ReviewCategory>();
  const r = `${reason} ${row.review_reason ?? ""}`.toLowerCase();
  if (isDuplicate) cats.add("duplicate_ledger_entry");
  if (squareLinkedCount > 1) cats.add("multiple_square_linked");
  if (r.includes("no phone")) cats.add("missing_phone");
  const isAmountOnly = r.includes("amount-only") || (r.includes("special billing") && !r.includes("leading amount differs"));
  if (isAmountOnly) cats.add("amount_only_package");
  if (r.includes("leading amount differs")) cats.add("leading_amount_mismatch");

  if (!isAmountOnly && (r.includes("no package price") || r.includes("no visit count"))) {
    cats.add("missing_package_information");
  }
  if (r.includes("credit") || r.includes("overpaid") || r.includes("refund")) cats.add("credit_special_balance");
  if (r.includes("multiple names")) cats.add("multiple_names_on_line");
  if (r.includes("no matching client") || r.includes("no candidate matches")) cats.add("no_match");
  if (r.includes("same normalized name")) cats.add("ambiguous_match");
  if (r.includes("multiple candidates") || r.includes("multiple square")) {
    if (squareLinkedCount <= 1) cats.add("ambiguous_match");
  }
  if (cats.size === 0) cats.add("other");
  return Array.from(cats);
}

export type AutoUpdateRow = {
  parsed: ParsedRow;
  client: MatchClient;
  changes: {
    package_price: { before: number; after: number; changed: boolean };
    package_total_visits: { before: number; after: number; changed: boolean };
    package_start_date: { before: string | null; after: string | null; changed: boolean };
    amount_paid: { before: number; after: number; changed: boolean };
    amount_owed: { before: number; after: number; changed: boolean };
    internal_notes: { before: string | null; after: string | null; changed: boolean; appended: string | null; appended_count: number; note_status: NoteStatus };
  };
};

export type SkippedRow = {
  parsed: ParsedRow;
  reason: string;
  resolution: LedgerResolutionState;
};

export type PreviewResult = {
  parsed_count: number;
  auto_updates: AutoUpdateRow[];
  reviews: ReviewRow[];
  skipped: SkippedRow[];
  diagnostics: RowDiagnostic[];
  diagnostic_summary: DiagnosticSummary;
};

function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.replace(/\D+/g, "");
  if (!d) return null;
  return d.length > 10 ? d.slice(-10) : d.length === 10 ? d : null;
}

async function loadAllClients(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<MatchClient[]> {
  const out: MatchClient[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("clients")
      .select(
        "id, first_name, last_name, phone, email, square_customer_id, status, package_price, package_total_visits, package_start_date, amount_paid, internal_notes",
      )
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as MatchClient[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function normalizeNoteForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip phone-number-like digit runs so notes that differ only by a phone compare as equal. */
function stripPhones(s: string): string {
  return s
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNoteNoPhone(s: string): string {
  return normalizeNoteForCompare(stripPhones(s));
}

const JUNK_LINE_RE = /^[\s\-–—.()·•*]*$/;

function isJunkLine(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (JUNK_LINE_RE.test(t)) return true;
  if (!normalizeNoteForCompare(t)) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] =
        a.charCodeAt(i - 1) === b.charCodeAt(j - 1)
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function similarity(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  if (m === 0) return 1;
  return 1 - levenshtein(a, b) / m;
}

/** Word-boundary containment: is `needle` fully contained inside `hay`? */
function containsPhrase(hay: string, needle: string): boolean {
  if (!needle) return true;
  if (!hay) return false;
  if (hay === needle) return true;
  return (" " + hay + " ").includes(" " + needle + " ") || hay.includes(needle);
}

function isDuplicateLine(
  n: string,
  nNoPhone: string,
  existingNorm: string[],
  existingNormNoPhone: string[],
): boolean {
  for (let i = 0; i < existingNorm.length; i++) {
    const ex = existingNorm[i];
    const exNoPhone = existingNormNoPhone[i];
    if (ex === n) return true;
    if (containsPhrase(ex, n) || containsPhrase(n, ex)) return true;
    if (similarity(n, ex) >= 0.95) return true;
    if (nNoPhone && exNoPhone) {
      if (exNoPhone === nNoPhone) return true;
      if (containsPhrase(exNoPhone, nNoPhone) || containsPhrase(nNoPhone, exNoPhone)) return true;
      if (similarity(nNoPhone, exNoPhone) >= 0.95) return true;
    }
  }
  return false;
}

/** Dedupe incoming notes line-by-line against existing notes. */
export function dedupeNoteLines(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): { appended: string | null; count: number } {
  if (!incoming) return { appended: null, count: 0 };
  const existingNorm: string[] = [];
  const existingNormNoPhone: string[] = [];
  for (const l of (existing ?? "").split(/\r?\n/)) {
    if (isJunkLine(l)) continue;
    const n = normalizeNoteForCompare(l);
    if (n) {
      existingNorm.push(n);
      existingNormNoPhone.push(normalizeNoteNoPhone(l));
    }
  }
  const kept: string[] = [];
  for (const raw of incoming.split(/\r?\n/)) {
    if (isJunkLine(raw)) continue;
    const line = raw.trim();
    const n = normalizeNoteForCompare(line);
    if (!n) continue;
    const nNoPhone = normalizeNoteNoPhone(line);
    if (isDuplicateLine(n, nNoPhone, existingNorm, existingNormNoPhone)) continue;
    existingNorm.push(n);
    existingNormNoPhone.push(nNoPhone);
    kept.push(line);
  }
  if (kept.length === 0) return { appended: null, count: 0 };
  return { appended: kept.join("\n"), count: kept.length };
}

export function noteAlreadyExists(existing: string | null | undefined, incoming: string | null | undefined): boolean {
  if (!incoming || !incoming.trim()) return false;
  return dedupeNoteLines(existing, incoming).count === 0;
}

function buildChanges(parsed: ParsedRow, client: MatchClient): AutoUpdateRow["changes"] {
  const clientPrice = Number(client.package_price ?? 0);
  const clientPaid = Number(client.amount_paid ?? 0);

  // Leading-amount mismatch: the parenthetical package_price is informational
  // only. Preserve the client's current package_price and set amount_paid so
  // owed == leading_amount. Visits/date can still update from parsed values.
  const isMismatch = parsed.leading_amount_mismatch === true;
  const newPrice = isMismatch ? clientPrice : (parsed.package_price ?? clientPrice);
  const newVisits = parsed.package_total_visits ?? Number(client.package_total_visits ?? 0);
  const newDate = parsed.package_start_date ?? client.package_start_date;
  const newPaid = isMismatch
    ? Math.max(0, newPrice - Number(parsed.leading_amount ?? 0))
    : parsed.amount_paid !== null
      ? parsed.amount_paid
      : clientPaid;
  const newOwed = Math.max(0, newPrice - newPaid);
  const currentOwed = Math.max(0, clientPrice - clientPaid);


  const currentNotes = client.internal_notes ?? "";
  let appendedNote: string | null = null;
  let appendedCount = 0;
  let noteStatus: NoteStatus = "no_note";
  if (parsed.internal_notes && parsed.internal_notes.trim()) {
    const dedup = dedupeNoteLines(currentNotes, parsed.internal_notes);
    if (dedup.count === 0) {
      noteStatus = "already_exists";
    } else {
      appendedNote = dedup.appended;
      appendedCount = dedup.count;
      noteStatus = "append";
    }
  }
  const newNotes = appendedNote
    ? (currentNotes ? `${currentNotes}\n${appendedNote}` : appendedNote)
    : (currentNotes || null);

  return {
    package_price: {
      before: Number(client.package_price ?? 0),
      after: newPrice,
      changed: Number(client.package_price ?? 0) !== newPrice,
    },
    package_total_visits: {
      before: Number(client.package_total_visits ?? 0),
      after: newVisits,
      changed: Number(client.package_total_visits ?? 0) !== newVisits,
    },
    package_start_date: {
      before: client.package_start_date,
      after: newDate,
      changed: (client.package_start_date ?? null) !== (newDate ?? null),
    },
    amount_paid: {
      before: Number(client.amount_paid ?? 0),
      after: newPaid,
      changed: Number(client.amount_paid ?? 0) !== newPaid,
    },
    amount_owed: {
      before: currentOwed,
      after: newOwed,
      changed: currentOwed !== newOwed,
    },
    internal_notes: {
      before: client.internal_notes,
      after: newNotes,
      changed: appendedNote !== null,
      appended: appendedNote,
      appended_count: appendedCount,
      note_status: noteStatus,
    },
  };
}

function computeRowNoteStatus(parsed: ParsedRow, candidates: MatchClient[]): NoteStatus {
  if (!parsed.internal_notes || !parsed.internal_notes.trim()) return "no_note";
  if (candidates.length > 0 && candidates.every((c) => noteAlreadyExists(c.internal_notes, parsed.internal_notes))) {
    return "already_exists";
  }
  return "append";
}

export const previewNotesLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => input)
  .handler(async ({ data, context }): Promise<PreviewResult> => {
    const parsed = parseLedger(data.text);
    const clients = await loadAllClients(context.supabase);

    // Build index
    const byName = new Map<string, MatchClient[]>();
    const byPhone = new Map<string, MatchClient[]>();
    for (const c of clients) {
      const n = normName(`${c.first_name} ${c.last_name}`);
      if (n) {
        const list = byName.get(n) ?? [];
        list.push(c);
        byName.set(n, list);
      }
      const p = normPhone(c.phone);
      if (p) {
        const list = byPhone.get(p) ?? [];
        list.push(c);
        byPhone.set(p, list);
      }
    }

    const activeCandidatesFor = (row: ParsedRow) => {
      const key = normName(row.name ?? "");
      const nameHitsRaw = key ? (byName.get(key) ?? []) : [];
      const phoneHitsRaw = row.phone ? (byPhone.get(row.phone) ?? []) : [];
      const isArchived = (c: MatchClient) => c.status === "archived";
      return dedupe([
        ...nameHitsRaw.filter((c) => !isArchived(c)),
        ...phoneHitsRaw.filter((c) => !isArchived(c)),
      ]);
    };

    // Normalize special amount-only rows before fingerprint lookup so the
    // durable key includes the package fields staff will actually apply.
    for (const row of parsed) {
      const combined = activeCandidatesFor(row);
      if (
        row.leading_amount !== null &&
        row.leading_amount > 0 &&
        row.package_price === null &&
        row.package_total_visits === null &&
        combined.length === 1
      ) {
        row.package_price = row.leading_amount;
        row.amount_paid = 0;
        row.amount_owed = row.leading_amount;
        row.paid_in_full = false;
        row.needs_review = true;
        row.review_reason =
          "Amount-only package / special billing — leading amount before name, no package price or visit count in ledger.";
        row.row_fingerprint = buildLedgerRowFingerprint(row);
      }
    }

    const resolvedByFingerprint = await loadResolvedFingerprints(
      context.supabase,
      parsed.map((r) => r.row_fingerprint),
    );

    const auto: AutoUpdateRow[] = [];
    const reviews: ReviewRow[] = [];
    const skipped: SkippedRow[] = [];
    const diagnostics: RowDiagnostic[] = [];
    const summary: DiagnosticSummary = {
      parser_needs_review: 0,
      no_match: 0,
      multiple_phone_matches: 0,
      multiple_name_matches: 0,
      multiple_square_linked: 0,
      ambiguous_no_square_winner: 0,
      no_changes_vs_current: 0,
      auto_updates: 0,
    };

    // Detect duplicate parsed-name occurrences across the ledger.
    // If the same normalized parsed name appears more than once, route ALL
    // occurrences to Review so an older package line can't overwrite a newer one.
    const parsedNameCounts = new Map<string, number>();
    for (const r of parsed) {
      if (r.needs_review) continue;
      const k = normName(r.name ?? "");
      if (!k) continue;
      parsedNameCounts.set(k, (parsedNameCounts.get(k) ?? 0) + 1);
    }

    for (const row of parsed) {
      const key = normName(row.name ?? "");
      const nameHitsRaw = key ? (byName.get(key) ?? []) : [];
      const phoneHitsRaw = row.phone ? (byPhone.get(row.phone) ?? []) : [];
      // Exclude archived clients from active matching. Track them separately.
      const isArchived = (c: MatchClient) => c.status === "archived";
      const nameHits = nameHitsRaw.filter((c) => !isArchived(c));
      const phoneHits = phoneHitsRaw.filter((c) => !isArchived(c));
      const combined = dedupe([...nameHits, ...phoneHits]);
      const archivedCandidates = dedupe(
        [...nameHitsRaw, ...phoneHitsRaw].filter(isArchived),
      );
      const squareLinked = combined.filter((c) => c.square_customer_id);
      const duplicateParsed = !row.needs_review && key ? (parsedNameCounts.get(key) ?? 0) > 1 : false;


      const diagBase: Omit<RowDiagnostic, "outcome" | "rule" | "reason"> = {
        line_number: row.line_number,
        parsed_name: row.name ?? null,
        parsed_phone: row.phone ?? null,
        parsed_package_price: row.package_price ?? null,
        parsed_package_date: row.package_start_date ?? null,
        parsed_visits: row.package_total_visits ?? null,
        parsed_amount_paid: row.amount_paid ?? null,
        phone_match_count: phoneHits.length,
        name_match_count: nameHits.length,
        combined_unique_count: combined.length,
        square_linked_count: squareLinked.length,
      };

      const rowResolution = resolutionStateFor(row, resolvedByFingerprint);
      if (rowResolution.state === "previously_resolved") {
        skipped.push({
          parsed: row,
          reason: "Already resolved from prior review",
          resolution: rowResolution,
        });
        diagnostics.push({
          ...diagBase,
          outcome: "skipped_prior_resolution",
          rule: "row_fingerprint exists in Notes Ledger resolutions",
          reason: `Already resolved from prior review (${rowResolution.status}).`,
        });
        summary.no_changes_vs_current++;
        continue;
      }

      const pushReview = (reason: string, isDup: boolean) => {
        reviews.push({
          ...row,
          candidates: combined,
          archived_candidates: archivedCandidates,
          reason,
          categories: classifyReview(row, reason, squareLinked.length, combined.length, isDup),
          note_status: computeRowNoteStatus(row, combined),
          resolution: { state: "unresolved" },
        });
      };

      if (row.needs_review) {
        const reason = row.review_reason ?? "Needs manual review.";
        if (combined.length === 1) {
          const changes = buildChanges(row, combined[0]);
          const anyChange =
            changes.package_price.changed ||
            changes.package_total_visits.changed ||
            changes.package_start_date.changed ||
            changes.amount_paid.changed ||
            changes.internal_notes.changed;
          if (!anyChange) {
            skipped.push({
              parsed: row,
              reason: "No changes vs current Admin data.",
              resolution: { state: "unresolved" },
            });
            diagnostics.push({
              ...diagBase,
              outcome: "skipped_no_changes",
              rule: "review row has one active candidate and no remaining package/payment/note changes",
              reason: `Matched ${combined[0].first_name} ${combined[0].last_name}; existing Admin data already equals parsed values.`,
            });
            summary.no_changes_vs_current++;
            continue;
          }
        }
        pushReview(reason, false);
        diagnostics.push({
          ...diagBase,
          outcome: "parser_review",
          rule: "parser flagged row.needs_review=true",
          reason: row.review_reason ?? "Parser could not confidently parse row.",
        });
        summary.parser_needs_review++;
        continue;
      }

      if (duplicateParsed) {
        const dupReason = "Multiple ledger entries for same client — manual package selection required.";
        pushReview(dupReason, true);
        diagnostics.push({
          ...diagBase,
          outcome: "review",
          rule: "duplicate parsed_name in ledger → force manual selection",
          reason: dupReason,
        });
        summary.parser_needs_review++;
        continue;
      }



      let chosen: MatchClient | null = null;
      let reason = "";
      let rule = "";
      // Priority (archived clients excluded from active matching):
      // 1. Exactly one active exact normalized-name match → auto-pick.
      // 2. Multiple active candidates with the same normalized name → Review.
      // 3. No exact name match → fall back to Square-linked / single active
      //    phone candidate, otherwise Review.
      if (nameHits.length === 1) {
        chosen = nameHits[0];
        rule = nameHits[0].square_customer_id
          ? "exactly one active exact name match (Square-linked)"
          : "exactly one active exact name match";
      } else if (nameHits.length > 1) {
        reason = `Multiple active candidates with same normalized name (${nameHits.length}).`;
        rule = "nameHits.length > 1 → cannot auto-pick";
        summary.multiple_name_matches++;
      } else if (squareLinked.length === 1) {
        chosen = squareLinked[0];
        rule = "no name match; exactly one active Square-linked phone candidate";
      } else if (squareLinked.length > 1) {
        reason = `No candidate matches parsed name; multiple active Square-linked candidates share phone (${squareLinked.length}).`;
        rule = "no name match; squareLinked.length > 1 via phone";
        summary.multiple_square_linked++;
      } else if (combined.length === 1) {
        chosen = combined[0];
        rule = "no name match; exactly one active candidate via phone, not Square-linked";
      } else if (combined.length > 1) {
        reason = `No candidate matches parsed name; multiple active phone candidates (${combined.length}).`;
        rule = "no name match; multiple phone candidates";
        if (phoneHits.length > 1) summary.multiple_phone_matches++;
        else summary.ambiguous_no_square_winner++;
      } else {
        reason = "No matching client found.";
        rule = "phoneHits.length===0 AND nameHits.length===0";
        summary.no_match++;
      }

      if (!chosen) {
        pushReview(reason, false);
        diagnostics.push({ ...diagBase, outcome: "review", rule, reason });
        continue;
      }


      const changes = buildChanges(row, chosen);
      const anyChange =
        changes.package_price.changed ||
        changes.package_total_visits.changed ||
        changes.package_start_date.changed ||
        changes.amount_paid.changed ||
        changes.internal_notes.changed;
      if (!anyChange) {
        skipped.push({ parsed: row, reason: "No changes vs current Admin data.", resolution: { state: "unresolved" } });
        diagnostics.push({
          ...diagBase,
          outcome: "skipped_no_changes",
          rule: "matched client, but price/visits/date/paid/notes all equal",
          reason: `Matched ${chosen.first_name} ${chosen.last_name}; existing Admin data already equals parsed values.`,
        });
        summary.no_changes_vs_current++;
        continue;
      }
      auto.push({ parsed: row, client: chosen, changes });
      diagnostics.push({
        ...diagBase,
        outcome: "auto_update",
        rule,
        reason: `Matched ${chosen.first_name} ${chosen.last_name}${chosen.square_customer_id ? " (Square-linked)" : ""}.`,
      });
      summary.auto_updates++;
    }

    return {
      parsed_count: parsed.length,
      auto_updates: auto,
      reviews,
      skipped,
      diagnostics,
      diagnostic_summary: summary,
    };
  });

function dedupe(arr: MatchClient[]): MatchClient[] {
  const seen = new Set<string>();
  const out: MatchClient[] = [];
  for (const c of arr) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export type ApplyRowResult = {
  client_id: string;
  client_name: string;
  parsed_name: string | null;
  line_number: number | null;
  status: "success" | "error";
  step: "read" | "update" | "activity" | "ok";
  error: string | null;
  fields: {
    row_fingerprint: string | null;
    package_price: number;
    package_total_visits: number;
    package_start_date: string | null;
    amount_paid: number;
    appended_note: string | null;
    internal_notes_after: string | null;
  };
  before: {
    package_price: number;
    package_total_visits: number;
    package_start_date: string | null;
    amount_paid: number;
    internal_notes: string | null;
  } | null;
};


export type ApplyResult = {
  updated: number;
  errors: { client_id: string; error: string }[];
  rows: ApplyRowResult[];
};

export const applyNotesLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      updates: {
        client_id: string;
        client_name?: string | null;
        parsed_name?: string | null;
        line_number?: number | null;
        resolution_row?: LedgerResolutionInput | null;
        package_price: number;
        package_total_visits: number;
        package_start_date: string | null;
        amount_paid: number;
        appended_note: string | null;
      }[];
    }) => input,
  )
  .handler(async ({ data, context }): Promise<ApplyResult> => {
    const { supabase } = context;
    const errors: ApplyResult["errors"] = [];
    const rows: ApplyRowResult[] = [];
    let updated = 0;

    for (const u of data.updates) {
      const baseFields = {
        row_fingerprint: u.resolution_row?.row_fingerprint ?? null,
        package_price: u.package_price,
        package_total_visits: u.package_total_visits,
        package_start_date: u.package_start_date,
        amount_paid: u.amount_paid,
        appended_note: u.appended_note,
        internal_notes_after: null as string | null,
      };
      const clientName = u.client_name ?? "(unknown)";

      const { data: current, error: readErr } = await supabase
        .from("clients")
        .select("internal_notes, package_price, package_total_visits, package_start_date, amount_paid")
        .eq("id", u.client_id)
        .single();
      if (readErr) {
        errors.push({ client_id: u.client_id, error: readErr.message });
        rows.push({
          client_id: u.client_id,
          client_name: clientName,
          parsed_name: u.parsed_name ?? null,
          line_number: u.line_number ?? null,
          status: "error",
          step: "read",
          error: readErr.message,
          fields: baseFields,
          before: null,
        });
        continue;
      }

      const beforeSnapshot = {
        package_price: Number(current?.package_price ?? 0),
        package_total_visits: Number(current?.package_total_visits ?? 0),
        package_start_date: (current?.package_start_date as string | null) ?? null,
        amount_paid: Number(current?.amount_paid ?? 0),
        internal_notes: (current?.internal_notes as string | null) ?? null,
      };

      let newNotes: string | null = (current?.internal_notes as string | null) ?? null;
      if (u.appended_note) {
        const dedup = dedupeNoteLines(newNotes, u.appended_note);
        if (dedup.count > 0 && dedup.appended) {
          newNotes = newNotes ? `${newNotes}\n${dedup.appended}` : dedup.appended;
        }
      }
      baseFields.internal_notes_after = newNotes;


      const { error: updErr } = await supabase
        .from("clients")
        .update({
          package_price: u.package_price,
          package_total_visits: u.package_total_visits,
          package_start_date: u.package_start_date,
          amount_paid: u.amount_paid,
          internal_notes: newNotes,
        })
        .eq("id", u.client_id);
      if (updErr) {
        const e = updErr as { message: string; hint?: string; details?: string; code?: string };
        const detail = `${e.message}${e.hint ? ` — ${e.hint}` : ""}${e.details ? ` (${e.details})` : ""}${e.code ? ` [${e.code}]` : ""}`;
        errors.push({ client_id: u.client_id, error: detail });
        rows.push({
          client_id: u.client_id,
          client_name: clientName,
          parsed_name: u.parsed_name ?? null,
          line_number: u.line_number ?? null,
          status: "error",
          step: "update",
          error: detail,
          fields: baseFields,
          before: beforeSnapshot,

        });
        continue;
      }

      const { error: actErr } = await supabase.from("client_activities").insert({
        client_id: u.client_id,
        activity_type: "notes_ledger_import",
        description: "Updated from latest Apple Notes package ledger",
        metadata: {
          package_price: u.package_price,
          package_total_visits: u.package_total_visits,
          package_start_date: u.package_start_date,
          amount_paid: u.amount_paid,
          appended_note: u.appended_note,
          row_fingerprint: u.resolution_row?.row_fingerprint ?? null,
        },
      });
      if (actErr) {
        errors.push({ client_id: u.client_id, error: `activity: ${actErr.message}` });
        rows.push({
          client_id: u.client_id,
          client_name: clientName,
          parsed_name: u.parsed_name ?? null,
          line_number: u.line_number ?? null,
          status: "error",
          step: "activity",
          error: `Client update succeeded, but activity log insert failed: ${actErr.message}`,
          fields: baseFields,
          before: beforeSnapshot,

        });
        continue;
      }

      if (u.resolution_row) {
        try {
          await persistLedgerResolution(
            supabase,
            context.userId,
            u.resolution_row,
            "imported",
            "Applied to selected client",
            u.client_id,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ client_id: u.client_id, error: `resolution: ${message}` });
          rows.push({
            client_id: u.client_id,
            client_name: clientName,
            parsed_name: u.parsed_name ?? null,
            line_number: u.line_number ?? null,
            status: "error",
            step: "activity",
            error: `Client update succeeded, but resolution record failed: ${message}`,
            fields: baseFields,
            before: beforeSnapshot,
          });
          continue;
        }
      }

      updated++;
      rows.push({
        client_id: u.client_id,
        client_name: clientName,
        parsed_name: u.parsed_name ?? null,
        line_number: u.line_number ?? null,
        status: "success",
        step: "ok",
        error: null,
        fields: baseFields,
        before: beforeSnapshot,
      });
    }

    return { updated, errors, rows };
  });

export const resolveNotesLedgerRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      row: LedgerResolutionInput;
      status: Exclude<LedgerResolutionStatus, "imported">;
      reason?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const reason = data.reason?.trim() || (data.status === "skipped" ? "Skipped row" : "Marked resolved");
    await persistLedgerResolution(context.supabase, context.userId, data.row, data.status, reason, null);
    return {
      ok: true,
      row_fingerprint: data.row.row_fingerprint,
      status: data.status,
      reason,
    };
  });

export const undoNotesLedgerApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      client_id: string;
      row_fingerprint?: string | null;
      before: {
        package_price: number;
        package_total_visits: number;
        package_start_date: string | null;
        amount_paid: number;
        internal_notes: string | null;
      };
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error: updErr } = await supabase
      .from("clients")
      .update({
        package_price: data.before.package_price,
        package_total_visits: data.before.package_total_visits,
        package_start_date: data.before.package_start_date,
        amount_paid: data.before.amount_paid,
        internal_notes: data.before.internal_notes,
      })
      .eq("id", data.client_id);
    if (updErr) throw new Error(updErr.message);
    await supabase.from("client_activities").insert({
      client_id: data.client_id,
      activity_type: "notes_ledger_import_undo",
      description: "Reverted a Notes Ledger import (undo)",
      metadata: data.before,
    });
    if (data.row_fingerprint) {
      const { error: resolutionErr } = await supabase
        .from("notes_ledger_resolutions")
        .delete()
        .eq("row_fingerprint", data.row_fingerprint);
      if (resolutionErr) throw new Error(resolutionErr.message);
    }
    return { ok: true };
  });

