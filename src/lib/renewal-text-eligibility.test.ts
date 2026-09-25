import { describe, expect, it } from "vitest";
import { resolveEffectiveVisitState } from "./effective-visit-state";
import { campaignShouldAutoClear, decideRenewalText, renewalAutoTextEnabled } from "./renewal-text-eligibility";

const now = "2026-09-24T12:00:00Z";
const b = (id: string, d: string, note: string, status = "ACCEPTED") => ({ id, start_at: `${d}T15:00:00Z`, seller_note: note, status });
const client = (over: Partial<Parameters<typeof decideRenewalText>[0]> = {}) => ({
  id: "c1", phone: "9315550000", square_customer_id: "SQ", package_total_visits: 8, visits_used: 7,
  package_price: 400, amount_paid: 400, sms_consent_at: "2026-01-01T00:00:00Z", sms_opted_out_at: null, ...over,
});
const sq7 = [b("1", "2026-09-10", "6/8"), b("2", "2026-09-17", "7/8"), b("3", "2026-09-30", "8/8"), b("4", "2026-10-07", "1/8")];

describe("decideRenewalText", () => {
  it("Square 7/8 with future 8/8 → eligible, last visit = the 8/8 date", () => {
    const c = client({ visits_used: 3 });
    const d = decideRenewalText(c, resolveEffectiveVisitState(c, sq7, now), [], false);
    expect(d.eligible).toBe(true);
    expect(d.basis).toBe("Square 7/8 with future 8/8");
    expect(d.lastVisitDate).toBe("2026-09-30T15:00:00Z");
  });
  it("Square 8/8 → not eligible even if Hub says 7/8", () => {
    const c = client();
    const s = resolveEffectiveVisitState(c, [b("1", "2026-09-10", "7/8"), b("2", "2026-09-17", "8/8"), b("3", "2026-09-30", "1/8")], now);
    expect(decideRenewalText(c, s, ["2026-09-30T15:00:00Z", "2026-10-07T15:00:00Z"], false).eligible).toBe(false);
  });
  it("review_required → suppressed", () => {
    const c = client();
    const s = resolveEffectiveVisitState(c, [b("1", "2026-09-03", "3/8"), b("2", "2026-09-10", "5/8"), b("3", "2026-09-17", "4/8")], now);
    expect(s.source).toBe("review_required");
    const d = decideRenewalText(c, s, [], false);
    expect(d.suppressed).toBe(true);
    expect(d.eligible).toBe(false);
  });
  it("opted out → blocked even with consent", () => {
    const c = client({ visits_used: 3, sms_opted_out_at: "2026-05-01T00:00:00Z" });
    const d = decideRenewalText(c, resolveEffectiveVisitState(c, sq7, now), [], false);
    expect(d.consentBlocked).toBe("opted_out");
  });
  it("no consent → blocked", () => {
    const c = client({ visits_used: 3, sms_consent_at: null });
    expect(decideRenewalText(c, resolveEffectiveVisitState(c, sq7, now), [], false).consentBlocked).toBe("no_consent");
  });
  it("Hub fallback unchanged: Hub 7/8 + 2 upcoming → eligible", () => {
    const c = client();
    const s = resolveEffectiveVisitState(c, [], now);
    expect(s.source).toBe("hub_fallback");
    const d = decideRenewalText(c, s, ["2026-09-30T15:00:00Z", "2026-10-07T15:00:00Z"], false);
    expect(d.eligible).toBe(true);
    expect(d.lastVisitDate).toBe("2026-09-30T15:00:00Z");
  });
  it("review_required campaigns are never auto-cleared", () => {
    const c = client();
    const s = resolveEffectiveVisitState(c, [b("1", "2026-09-03", "3/8"), b("2", "2026-09-10", "5/8"), b("3", "2026-09-17", "4/8")], now);
    expect(campaignShouldAutoClear(s, { package_start_date: null, package_total_visits: 8, visits_used: 0 },
      { package_start_date_snapshot: null, package_total_visits_snapshot: 8 })).toBeNull();
  });
  it("kill switch only on for exact 'true'", () => {
    expect(renewalAutoTextEnabled(undefined)).toBe(false);
    expect(renewalAutoTextEnabled("TRUE")).toBe(false);
    expect(renewalAutoTextEnabled("true")).toBe(true);
  });
});
