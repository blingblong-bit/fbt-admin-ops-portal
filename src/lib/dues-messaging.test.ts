import { describe, expect, it } from "vitest";
import {
  buildBalanceDraft,
  buildConsentConfirmationDraft,
  buildRenewalDraft,
  smsEligibility,
  draftChanged,
  duesRequestKey,
  hasSmsConsent,
  isDuesQueueEligible,
  isSendable,
  renderBalanceDueMessage,
  renderRenewalDueMessage,
  renewalAmountDue,
  validateDraft,
  type DuesClient,
} from "@/lib/dues-messaging";
import { sendDuesMessage, smsSendingEnabled } from "@/lib/dues-sms.server";

const base: DuesClient & { package_start_date: string | null } = {
  id: "c1",
  first_name: "Jane",
  last_name: "Doe",
  phone: "(555) 123-4567",
  package_price: 375,
  amount_paid: 0,
  payment_model: "package",
  package_total_visits: 8,
  visits_used: 2,
  previous_package_owed: 0,
  package_start_date: "2026-09-01",
  sms_consent_at: "2026-01-01T00:00:00Z",
  sms_consent_source: "intake form",
  sms_opted_out_at: null,
};

describe("queue eligibility", () => {
  it("includes a package client with a current balance", () => {
    expect(isDuesQueueEligible(base)).toBe(true);
  });
  it("excludes a fully paid client", () => {
    expect(isDuesQueueEligible({ ...base, amount_paid: 375 })).toBe(false);
  });
  it("includes a client with only previous-package debt", () => {
    expect(
      isDuesQueueEligible({ ...base, amount_paid: 375, previous_package_owed: 50 }),
    ).toBe(true);
  });
  it("excludes Package Info Needed", () => {
    expect(isDuesQueueEligible({ ...base, package_price: 0 })).toBe(false);
  });
  it("excludes Payment Review (unexplained overpayment)", () => {
    expect(isDuesQueueEligible({ ...base, amount_paid: 690 })).toBe(false);
  });
  it("excludes pay-per-visit clients with no unpaid balance", () => {
    expect(
      isDuesQueueEligible({
        ...base,
        payment_model: "pay_per_visit",
        package_price: 0,
        amount_paid: 0,
      }),
    ).toBe(false);
  });
  it("excludes archived and deleted records", () => {
    expect(isDuesQueueEligible({ ...base, status: "archived" })).toBe(false);
    expect(isDuesQueueEligible({ ...base, deleted_at: "2026-01-01" })).toBe(false);
  });
});

describe("message bodies", () => {
  it("renders the renewal body exactly", () => {
    expect(
      renderRenewalDueMessage({
        firstName: "Jane",
        totalVisits: 8,
        startDate: "2026-09-21",
        amount: 375,
      }),
    ).toBe(
      "Hi Jane, this is FIT Beyond Therapy. Your next 8-visit package is scheduled to start on 09/21/2026. The amount due will be $375.00. Reply here if you have any questions. Reply STOP to opt out.",
    );
  });
  it("renders the balance body exactly and generically", () => {
    const body = renderBalanceDueMessage({ firstName: "Jane", amount: 150 });
    expect(body).toBe(
      "Hi Jane, this is FIT Beyond Therapy. Just a reminder that our records show a remaining balance of $150.00. Reply here if you have any questions. Reply STOP to opt out.",
    );
    expect(body).not.toMatch(/current package|previous package/i);
  });
});

describe("blocking reasons", () => {
  it("blocks a missing phone number", () => {
    expect(validateDraft({ ...base, phone: null }, "balance_due", 100)).toContain(
      "No usable phone number on file",
    );
  });
  it("blocks missing consent", () => {
    expect(validateDraft({ ...base, sms_consent_at: null }, "balance_due", 100)).toContain(
      "No recorded texting consent",
    );
  });
  it("blocks a later opt-out", () => {
    const c = { ...base, sms_opted_out_at: "2026-05-01T00:00:00Z" };
    expect(hasSmsConsent(c)).toBe(false);
    expect(validateDraft(c, "balance_due", 100)).toContain("Client opted out of texts");
  });
  it("blocks Package Info Needed, Payment Review and $0 amounts", () => {
    expect(validateDraft({ ...base, package_price: 0 }, "balance_due", 0)).toEqual(
      expect.arrayContaining(["Package Info Needed", "Amount due is $0 or less"]),
    );
    expect(validateDraft({ ...base, amount_paid: 690 }, "balance_due", 1)).toContain(
      "Payment Review — unexplained overpayment",
    );
  });
  it("blocks an inconsistent prepared renewal", () => {
    const w = validateDraft({ ...base }, "renewal_due", 0);
    expect(w).toEqual(
      expect.arrayContaining([
        "Prepared package has no start date",
        "Prepared package has no price",
        "Prepared package has no visit count",
      ]),
    );
  });
});

describe("renewal amount", () => {
  it("is net of anything already prepaid", () => {
    expect(
      renewalAmountDue({ pending_renewal_price: 375, pending_renewal_paid: 100 }),
    ).toBe(275);
  });
  it("builds a renewal draft using the net amount", () => {
    const d = buildRenewalDraft({
      ...base,
      amount_paid: 375,
      pending_renewal_start_date: "2026-09-21",
      pending_renewal_price: 375,
      pending_renewal_total_visits: 8,
      pending_renewal_paid: 100,
    });
    expect(d.amountDue).toBe(275);
    expect(d.blocked).toBe(false);
    expect(d.body).toContain("$275.00");
  });
});

describe("idempotency", () => {
  it("keeps the request key stable across repeat generation", () => {
    const c = { ...base, pending_renewal_start_date: "2026-09-21" };
    expect(duesRequestKey("renewal_due", c)).toBe(duesRequestKey("renewal_due", c));
    expect(duesRequestKey("balance_due", c)).toBe("balance:c1:2026-09-01");
  });
  it("keeps one renewal obligation per client when the date or price changes", () => {
    const before = { ...base, pending_renewal_start_date: "2026-09-21", pending_renewal_price: 375 };
    const after = { ...base, pending_renewal_start_date: "2026-10-05", pending_renewal_price: 400 };
    expect(duesRequestKey("renewal_due", after)).toBe(duesRequestKey("renewal_due", before));
  });
  it("reports no change when nothing material moved", () => {
    const plan = buildBalanceDraft(base);
    const existing = {
      body: plan.body,
      amount_due: plan.amountDue,
      status: "ready_not_sent",
      blocked: plan.blocked,
    };
    expect(draftChanged(existing, plan)).toBe(false);
    expect(draftChanged({ ...existing, amount_due: 999 }, plan)).toBe(true);
  });
});

describe("send path", () => {
  it("refuses while the flag is off", async () => {
    expect(smsSendingEnabled()).toBe(false);
    await expect(
      sendDuesMessage({
        id: "m1",
        phone: "+15551234567",
        body: "hi",
        status: "ready_not_sent",
        blocked: false,
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it("treats a blocked draft as not sendable even when status says ready", async () => {
    expect(isSendable({ status: "ready_not_sent", blocked: true })).toBe(false);
    expect(isSendable({ status: "ready_not_sent", blocked: false })).toBe(true);
    expect(isSendable({ status: "payment_received", blocked: false })).toBe(false);

    process.env["SMS_DUES_SENDING_ENABLED"] = "true";
    try {
      await expect(
        sendDuesMessage({
          id: "m2",
          phone: "+15551234567",
          body: "hi",
          status: "ready_not_sent",
          blocked: true,
        }),
      ).rejects.toThrow(/blocked/i);
    } finally {
      delete process.env["SMS_DUES_SENDING_ENABLED"];
    }
  });

  it("marks a paid-before-send draft as closed", () => {
    const paid = { ...base, amount_paid: 375 };
    expect(isDuesQueueEligible(paid)).toBe(false);
  });
});

describe("consent confirmation", () => {
  it("builds the approved opt-in wording with no amount", () => {
    const d = buildConsentConfirmationDraft(base);
    expect(d.messageType).toBe("consent_confirmation");
    expect(d.amountDue).toBe(0);
    expect(d.body).toContain("You're signed up for recurring customer-care texts");
    expect(d.body).toContain("Reply HELP for help or STOP to unsubscribe.");
    expect(d.blocked).toBe(false);
  });

  it("does not depend on money owed", () => {
    const paid = { ...base, amount_paid: 375 };
    expect(buildConsentConfirmationDraft(paid).blocked).toBe(false);
    expect(validateDraft(paid, "consent_confirmation", 0)).toEqual([]);
  });

  it("is keyed per consent event, so re-consent is a new obligation", () => {
    const first = duesRequestKey("consent_confirmation", base);
    const reconsented = duesRequestKey("consent_confirmation", {
      ...base,
      sms_consent_at: "2026-06-01T00:00:00Z",
    });
    expect(first).not.toBe(reconsented);
    expect(duesRequestKey("consent_confirmation", base)).toBe(first);
  });

  it("is blocked without consent or after an opt-out", () => {
    expect(
      buildConsentConfirmationDraft({ ...base, sms_consent_at: null }).blocked,
    ).toBe(true);
    expect(
      buildConsentConfirmationDraft({
        ...base,
        sms_opted_out_at: "2026-02-01T00:00:00Z",
      }).blocked,
    ).toBe(true);
  });
});

describe("dues message wording", () => {
  it("names FIT Beyond Therapy and carries no send-history footer", () => {
    const balance = renderBalanceDueMessage(base, 375);
    expect(balance).toContain("FIT Beyond Therapy");
    expect(balance).not.toContain("Reply STOP");
  });
});

describe("sms eligibility", () => {
  it("reports one status per client", () => {
    expect(smsEligibility(base)).toBe("consented");
    expect(smsEligibility({ ...base, sms_consent_at: null })).toBe("not_consented");
    expect(
      smsEligibility({ ...base, sms_opted_out_at: "2026-06-01T00:00:00Z" }),
    ).toBe("opted_out");
    expect(smsEligibility({ ...base, phone: null })).toBe("invalid_phone");
  });
});
