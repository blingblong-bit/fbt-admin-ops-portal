import { buildSequence, readBookingNote } from "./square-visit-audit";

export type PreparedEditEvidence = { start_at: string; status?: string | null; seller_note?: string | null; customer_note?: string | null };

/** A date move alone is a reschedule, not proof of a different package. */
export function preparedEditGuard(i: {
  prepaid: number; gate: string | null; bookings: PreparedEditEvidence[] | null;
  nowIso: string; hasPendingOverride?: boolean;
}): string | null {
  if (i.hasPendingOverride) return "This prepared package has an audited correction. Edit it in Profile → Edit packages → Prepared renewal so its recognized paid amount stays consistent.";
  if (!(i.prepaid > 0)) return null;
  if (!i.gate || !i.bookings) return "Prepaid money cannot be assigned to a package safely. Reconcile it in Profile → Edit packages → Prepared renewal before saving.";
  const live = i.bookings.filter((b) => /^(ACCEPTED|COMPLETED)$/i.test(b.status ?? ""));
  if (live.some((b) => readBookingNote(b) === "ambiguous")) return "Square package numbering is ambiguous. Reconcile prepaid money in Profile → Edit packages → Prepared renewal before saving.";
  const seq = buildSequence(live.map((b, index) => ({ ...b, id: String(index) })), i.nowIso);
  const ymd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const opened = seq.findIndex((e) => e.past && e.note?.n === 1 && ymd(e.date) >= (i.gate ?? ""));
  if (opened >= 0) return "Square already started a package after this prepared date. The existing prepaid money may belong to that older cycle. Reconcile it in Profile → Edit packages → Prepared renewal before preparing another cycle.";
  return null;
}

export function preparedEditAmounts(price: number, prepaid: number) {
  return { price, prepaid, due: Math.max(0, Math.round((price - prepaid) * 100) / 100) };
}

export function preparationTimestamp(existing: string | null | undefined, nowIso: string) {
  return existing ?? nowIso;
}