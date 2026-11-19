import { describe, expect, it } from "vitest";
import { assessmentPackageReview, catalogServices, type ReviewBooking } from "./assessment-package-review";
import { applyOverrides } from "./package-override";
import { computeMasterDues } from "./master-dues";

const now = "2026-11-19T20:25:00Z";
const services = catalogServices([
  { id: "assessment-item", item_data: { name: "Assessment" } },
  { id: "training-item", item_data: { name: "Individual Training Package - 8" } },
  { id: "a", item_variation_data: { name: "Regular", item_id: "assessment-item" } },
  { id: "t", item_variation_data: { name: "Regular", item_id: "training-item" } },
  { id: "c", item_variation_data: { name: "Custom Appt" } },
]);
const client = { id: "1", first_name: "Test", last_name: "Client", status: "active", package_total_visits: 8, package_price: 0, amount_paid: 0 };
const booking = (id: string, start_at: string, extra: Partial<ReviewBooking> = {}): ReviewBooking => ({ start_at, status: "ACCEPTED", appointment_segments: [{ service_variation_id: id }], ...extra });
const assessment = booking("a", "2026-11-16T16:00:00Z");
const training = booking("t", "2026-11-20T16:00:00Z");
const review = (bs: ReviewBooking[], c = client) => assessmentPackageReview(c, bs, services, now);

describe("assessment-to-training setup review", () => {
  it("uses parent service, not Regular variation labels", () => {
    expect(services.get("a")?.kind).toBe("assessment");
    expect(services.get("t")?.kind).toBe("training");
  });
  it("catches an 8-visit package with missing price", () => {
    expect(review([assessment, training])).toMatchObject({ client_id: "1", assessment_ymd: "2026-11-16", visit_ymd: "2026-11-20", upcoming: true });
  });
  it("includes training after assessment even without a package", () => {
    expect(review([assessment, training], { ...client, status: "assessment", package_total_visits: 0 })).not.toBeNull();
  });
  it("does not use cancelled training as evidence", () => {
    expect(review([assessment, { ...training, status: "CANCELLED_BY_SELLER" }])).toBeNull();
  });
  it("does not use a cancelled assessment as evidence", () => {
    expect(review([{ ...assessment, status: "CANCELLED_BY_CUSTOMER" }, training])).toBeNull();
  });
  it("does not treat a future assessment as already attended", () => {
    expect(review([booking("a", "2026-11-20T15:00:00Z"), training])).toBeNull();
  });
  it("does not infer assessment from notes or status", () => {
    expect(review([{ ...training, seller_note: "Assessment" }], { ...client, status: "assessment" })).toBeNull();
  });
  it("custom appointment requires numbered package evidence", () => {
    expect(review([assessment, booking("c", training.start_at ?? "")])).toBeNull();
    expect(review([assessment, booking("c", training.start_at ?? "", { seller_note: "1 of 4" })])).not.toBeNull();
  });
  it("unknown service and no-show do not imply a payable visit", () => {
    expect(review([assessment, booking("unknown", training.start_at ?? "", { seller_note: "1 of 8" })])).toBeNull();
    expect(review([assessment, { ...training, status: "NO_SHOW" }])).toBeNull();
  });
  it("effective saved price removes the gap without requiring payment", () => {
    const eff = applyOverrides(client, [{ slot: "current", total_visits: null, visits_used: null, price: 375, recognized_paid: null, start_date: null, status: "active" }]);
    expect(review([assessment, training], eff)).toBeNull();
    expect(client.package_price).toBe(0);
  });
  it("recorded payments do not imply a missing price means unpaid", () => {
    const c = { ...client, amount_paid: 375 };
    expect(review([assessment, training], c)).not.toBeNull();
    const dues = computeMasterDues([c], { todayYmd: "2026-11-19", nextAppointmentYmd: new Map(), renewalTiming: new Map() });
    expect(dues.totals.total).toBe(0);
    expect(dues.exceptions[0]?.kind).toBe("package_info_needed");
  });
  it("archived, deleted, weekly and pay-per-visit clients stay out", () => {
    for (const fields of [{ status: "archived" }, { deleted_at: now }, { billing_type: "weekly" }, { billing_type: "pay_per_visit" }, { payment_model: "pay_per_visit" }]) {
      expect(assessmentPackageReview({ ...client, ...fields }, [assessment, training], services, now)).toBeNull();
    }
  });
  it("past-only training stays a review, not an upcoming booking", () => {
    expect(review([assessment, booking("t", "2026-11-18T16:00:00Z")])?.upcoming).toBe(false);
  });
  it("training before the assessment does not qualify", () => {
    expect(review([assessment, booking("t", "2026-11-15T16:00:00Z")])).toBeNull();
  });
});