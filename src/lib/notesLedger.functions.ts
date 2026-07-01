import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseLedger, normName, type ParsedRow } from "./notesLedger";

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
  outcome: "auto_update" | "review" | "skipped_no_changes" | "parser_review";
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

export type ReviewRow = ParsedRow & {
  candidates: MatchClient[];
  reason: string;
};

export type AutoUpdateRow = {
  parsed: ParsedRow;
  client: MatchClient;
  changes: {
    package_price: { before: number; after: number; changed: boolean };
    package_total_visits: { before: number; after: number; changed: boolean };
    package_start_date: { before: string | null; after: string | null; changed: boolean };
    amount_paid: { before: number; after: number; changed: boolean };
    amount_owed: { before: number; after: number; changed: boolean };
    internal_notes: { before: string | null; after: string | null; changed: boolean; appended: string | null };
  };
};

export type SkippedRow = {
  parsed: ParsedRow;
  reason: string;
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

function buildChanges(parsed: ParsedRow, client: MatchClient): AutoUpdateRow["changes"] {
  const newPrice = parsed.package_price ?? Number(client.package_price ?? 0);
  const newVisits = parsed.package_total_visits ?? Number(client.package_total_visits ?? 0);
  const newDate = parsed.package_start_date ?? client.package_start_date;
  const newPaid =
    parsed.amount_paid !== null
      ? parsed.amount_paid
      : Number(client.amount_paid ?? 0);
  const newOwed = Math.max(0, newPrice - newPaid);
  const currentOwed = Math.max(0, Number(client.package_price ?? 0) - Number(client.amount_paid ?? 0));

  let appendedNote: string | null = null;
  const currentNotes = client.internal_notes ?? "";
  if (parsed.internal_notes && !currentNotes.includes(parsed.internal_notes)) {
    appendedNote = parsed.internal_notes;
  }
  const newNotes = appendedNote
    ? (currentNotes ? `${currentNotes}\n${appendedNote}` : appendedNote)
    : currentNotes || null;

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
    },
  };
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

    for (const row of parsed) {
      const key = normName(row.name ?? "");
      const nameHits = key ? (byName.get(key) ?? []) : [];
      const phoneHits = row.phone ? (byPhone.get(row.phone) ?? []) : [];
      const combined = dedupe([...nameHits, ...phoneHits]);
      const squareLinked = combined.filter((c) => c.square_customer_id);

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

      if (row.needs_review) {
        reviews.push({ ...row, candidates: combined, reason: row.review_reason ?? "Needs manual review." });
        diagnostics.push({
          ...diagBase,
          outcome: "parser_review",
          rule: "parser flagged row.needs_review=true",
          reason: row.review_reason ?? "Parser could not confidently parse row.",
        });
        summary.parser_needs_review++;
        continue;
      }

      let chosen: MatchClient | null = null;
      let reason = "";
      let rule = "";
      if (squareLinked.length === 1) {
        chosen = squareLinked[0];
        rule = "exactly one Square-linked candidate";
      } else if (squareLinked.length > 1) {
        reason = `Multiple Square-linked candidates (${squareLinked.length}).`;
        rule = "squareLinked.length > 1 → cannot auto-pick";
        summary.multiple_square_linked++;
      } else if (combined.length === 1) {
        chosen = combined[0];
        rule = "exactly one candidate (name or phone), not Square-linked";
      } else if (combined.length > 1) {
        reason = `Multiple candidates (${combined.length}); no Square-linked winner.`;
        rule = "combined.length > 1 with 0 Square-linked → cannot auto-pick";
        if (phoneHits.length > 1) summary.multiple_phone_matches++;
        else if (nameHits.length > 1) summary.multiple_name_matches++;
        else summary.ambiguous_no_square_winner++;
      } else {
        reason = "No matching client found.";
        rule = "phoneHits.length===0 AND nameHits.length===0";
        summary.no_match++;
      }

      if (!chosen) {
        reviews.push({ ...row, candidates: combined, reason });
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
        skipped.push({ parsed: row, reason: "No changes vs current Admin data." });
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

export type ApplyResult = {
  updated: number;
  errors: { client_id: string; error: string }[];
};

export const applyNotesLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      updates: {
        client_id: string;
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
    let updated = 0;

    for (const u of data.updates) {
      // Read current row to append notes safely
      const { data: current, error: readErr } = await supabase
        .from("clients")
        .select("internal_notes, package_price, package_total_visits, package_start_date, amount_paid")
        .eq("id", u.client_id)
        .single();
      if (readErr) {
        errors.push({ client_id: u.client_id, error: readErr.message });
        continue;
      }

      let newNotes = current?.internal_notes ?? null;
      if (u.appended_note && (!newNotes || !newNotes.includes(u.appended_note))) {
        newNotes = newNotes ? `${newNotes}\n${u.appended_note}` : u.appended_note;
      }

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
        errors.push({ client_id: u.client_id, error: updErr.message });
        continue;
      }

      await supabase.from("client_activities").insert({
        client_id: u.client_id,
        activity_type: "notes_ledger_import",
        description: "Updated from latest Apple Notes package ledger",
        metadata: {
          package_price: u.package_price,
          package_total_visits: u.package_total_visits,
          package_start_date: u.package_start_date,
          amount_paid: u.amount_paid,
          appended_note: u.appended_note,
        },
      });
      updated++;
    }

    return { updated, errors };
  });
