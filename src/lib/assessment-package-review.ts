// Read-only evidence projection. A missing price is never proof of debt.
import type { MasterDuesClient } from "./master-dues";

export type CatalogObject = {
  id: string;
  item_data?: { name?: string | null } | null;
  item_variation_data?: { name?: string | null; item_id?: string | null } | null;
};
export type ServiceKind = "assessment" | "assessment_package" | "training" | "custom" | "unknown";
export type Service = { name: string; kind: ServiceKind };
export function catalogServices(objects: CatalogObject[]): Map<string, Service> {
  const items = new Map(objects.filter((o) => o.item_data).map((o) => [o.id, o.item_data?.name ?? ""]));
  const out = new Map<string, Service>();
  for (const o of objects) {
    if (!o.item_variation_data) continue;
    const parent = items.get(o.item_variation_data.item_id ?? "");
    const name = parent || o.item_variation_data.name || "Unknown service";
    const label = name.trim().toLowerCase();
    const kind: ServiceKind = label === "assessment" ? "assessment"
      : /^assessment\s*\+\s*package\b/.test(label) ? "assessment_package"
      : /^(individual training package\b|single visit$|personal training\b)/.test(label) ? "training"
      : /^custom appt$/.test(label) ? "custom" : "unknown";
    out.set(o.id, { name, kind });
  }
  return out;
}
export type ReviewBooking = {
  start_at?: string | null; status?: string | null;
  seller_note?: string | null; customer_note?: string | null;
  appointment_segments?: { service_variation_id?: string | null }[] | null;
};
export type AssessmentReviewRow = {
  client_id: string; name: string; assessment_ymd: string; visit_ymd: string;
  service_name: string; upcoming: boolean; reason: string;
};
const chi = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export function assessmentPackageReview(
  c: MasterDuesClient, bookings: ReviewBooking[], services: Map<string, Service>, nowIso: string,
): AssessmentReviewRow | null {
  if (c.deleted_at || c.status === "archived" || c.billing_type === "weekly" || c.billing_type === "pay_per_visit" || c.payment_model === "pay_per_visit") return null;
  // Already configured packages belong to Master Dues, not this setup alert.
  if (Number(c.package_total_visits ?? 0) > 0 && Number(c.package_price ?? 0) > 0) return null;
  const live = bookings.filter((b) => b.start_at && Number.isFinite(Date.parse(b.start_at)) && /^(ACCEPTED|PENDING)$/.test(b.status ?? ""))
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  const kinds = (b: ReviewBooking) => (b.appointment_segments ?? []).flatMap((s) => {
    const service = services.get(s.service_variation_id ?? "");
    return service ? [service] : [];
  });
  const assessment = live.find((b) => String(b.start_at) < nowIso && kinds(b).some((s) => s.kind === "assessment" || s.kind === "assessment_package"));
  if (!assessment?.start_at) return null;
  const assessmentStart = assessment.start_at;
  const candidates = live.filter((b) => String(b.start_at) >= assessmentStart && kinds(b).some((s) =>
    s.kind === "training" || (s.kind === "custom" && /\b[1-9]\d*\s*(?:of|\/)\s*[1-9]\d*\b/i.test(`${b.seller_note ?? ""} ${b.customer_note ?? ""}`))));
  const visit = candidates.find((b) => String(b.start_at) >= nowIso) ?? candidates.at(-1);
  if (!visit?.start_at) return null;
  const service = kinds(visit).find((s) => s.kind === "training" || s.kind === "custom");
  return {
    client_id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), assessment_ymd: chi(assessment.start_at),
    visit_ymd: chi(visit.start_at), service_name: service?.name ?? "Training", upcoming: visit.start_at >= nowIso,
    reason: Number(c.package_total_visits ?? 0) > 0 ? "Package price missing — payment status unconfirmed" : "Training after assessment — package setup unconfirmed",
  };
}