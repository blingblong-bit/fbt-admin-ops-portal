// Server-only: auto-create package shells for clients with no package info,
// from coherent Square visit-note sequences. Price is never guessed — filled
// packages stay flagged for staff review until a price is set.
//
// Safety rules:
// - Only active, package-model, Square-linked clients with a completely blank
//   package (no total visits, no package name) are eligible.
// - Pay-per-visit clients and staff-dismissed ("No package needed") clients
//   are never touched.
// - Incoherent or isolated Square notes → no write, client is only reported.
// - No money, no messaging, no renewal side effects: package_price stays 0,
//   amount_paid stays 0, and the row is marked needs_review.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { loadSquareBookingIndex } from "@/lib/effective-visit-state.server";
import { packageAutofillFromBookings } from "@/lib/effective-visit-state";

export const AUTOFILL_ACTIVITY = "package_autofill_from_square";
const DISMISS_ACTIVITY = "package_review_dismissed";
const UNDISMISS_ACTIVITY = "package_review_redo";

export type AutofillReport = {
  ok: boolean;
  error?: string;
  filled: Array<{
    id: string;
    name: string;
    totalVisits: number;
    visitsUsed: number;
    startDate: string;
  }>;
  /** Had Square notes but not a coherent sequence — left for manual review. */
  flaggedOnly: Array<{ id: string; name: string; reason: string }>;
  skippedNoNotes: number;
  errors: string[];
};

export async function runPackageAutofill(
  supabase: SupabaseClient<Database>,
  squareToken: string,
): Promise<AutofillReport> {
  const report: AutofillReport = { ok: true, filled: [], flaggedOnly: [], skippedNoNotes: 0, errors: [] };

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, first_name, last_name, square_customer_id, payment_model, status, deleted_at, package_total_visits, package_name, package_price")
    .is("deleted_at", null)
    .not("square_customer_id", "is", null)
    .or("package_total_visits.is.null,package_total_visits.eq.0");
  if (error) return { ...report, ok: false, error: error.message };

  const eligible = (clients ?? []).filter(
    (c) =>
      c.payment_model !== "pay_per_visit" &&
      c.status !== "archived" &&
      (!(c.package_name ?? "").trim() || (c.package_name ?? "").trim().toLowerCase() === "custom package"),
  );
  if (eligible.length === 0) return report;

  // Staff-dismissed clients ("No package needed") are excluded; latest of
  // dismissed/redo wins.
  const { data: acts } = await supabase
    .from("client_activities")
    .select("client_id, activity_type, created_at")
    .in("activity_type", [DISMISS_ACTIVITY, UNDISMISS_ACTIVITY])
    .order("created_at", { ascending: true });
  const latest = new Map<string, string>();
  for (const a of acts ?? []) latest.set(a.client_id as string, a.activity_type as string);
  const dismissed = new Set<string>();
  for (const [id, type] of latest) if (type === DISMISS_ACTIVITY) dismissed.add(id);

  const index = await loadSquareBookingIndex(squareToken, 180, 90, { fresh: true });
  if (index.error) return { ...report, ok: false, error: `Square bookings unavailable: ${index.error}` };

  for (const c of eligible) {
    const name = `${c.first_name} ${c.last_name}`.trim();
    if (dismissed.has(c.id)) continue;
    const bookings = (index.byCustomer.get(c.square_customer_id as string) ?? [])
      .filter((b) => !!b.start_at)
      .map((b) => ({ id: b.id, start_at: b.start_at as string, seller_note: b.seller_note ?? null, status: b.status ?? null }));
    const hasNumberedNote = bookings.some((b) => (b.seller_note ?? "").trim().length > 0);
    const fill = packageAutofillFromBookings(bookings, index.nowIso);
    if (!fill) {
      if (hasNumberedNote) {
        report.flaggedOnly.push({ id: c.id, name, reason: "Square notes are not a coherent package sequence" });
      } else {
        report.skippedNoNotes++;
      }
      continue;
    }

    const priceNeeded = !(Number(c.package_price ?? 0) > 0);
    const { error: upErr } = await supabase
      .from("clients")
      .update({
        package_name: fill.packageName,
        package_total_visits: fill.totalVisits,
        visits_used: fill.visitsUsed,
        package_start_date: fill.startDate,
        needs_review: priceNeeded || fill.startEstimated,
        ...(c.status === "assessment" ? { status: "active" } : {}),
      })
      .eq("id", c.id)
      // Guard against racing a staff edit that already set a package.
      .or("package_total_visits.is.null,package_total_visits.eq.0");
    if (upErr) {
      report.errors.push(`${name}: ${upErr.message}`);
      continue;
    }

    await supabase.from("client_activities").insert({
      client_id: c.id,
      activity_type: AUTOFILL_ACTIVITY,
      description: `Package auto-created from Square visit notes: "${fill.packageName}" starting ${fill.startDate}${fill.startEstimated ? " (start date estimated)" : ""} (${fill.visitsUsed}/${fill.totalVisits} used).${priceNeeded ? " Price still needed." : ""}`,
      metadata: {
        source: "square_notes",
        package_name: fill.packageName,
        package_total_visits: fill.totalVisits,
        visits_used: fill.visitsUsed,
        package_start_date: fill.startDate,
        start_estimated: fill.startEstimated,
        price_needed: priceNeeded,
        previous_status: c.status,
      },
    });

    report.filled.push({
      id: c.id,
      name,
      totalVisits: fill.totalVisits,
      visitsUsed: fill.visitsUsed,
      startDate: fill.startDate,
    });
  }

  return report;
}
