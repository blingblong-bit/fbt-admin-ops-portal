import { describe, expect, it, vi } from "vitest";
import { loadDuesClients } from "./dues-messaging-clients";
import { buildBalanceDraft, buildRenewalDraft, isDuesQueueEligible } from "./dues-messaging";
import type { PackageOverride } from "./package-override";

const raw = {
  id: "c1", first_name: "Test", last_name: "Client", phone: "5551234567",
  package_price: 0, amount_paid: 0, package_total_visits: 8, visits_used: 1,
  previous_package_owed: 50, package_start_date: "2026-11-01", payment_model: "package",
  sms_consent_at: "2026-10-01", sms_opted_out_at: null, deleted_at: null,
};
const correction: PackageOverride & { client_id: string; cleared_at: string | null } = {
  client_id: "c1", slot: "current", price: 375, recognized_paid: null,
  total_visits: null, visits_used: null, start_date: null, status: "active", cleared_at: null,
};

function db(overrides = [correction], overrideError: Error | null = null) {
  const from = vi.fn((table: string) => {
    let data: any[] = table === "clients" ? [{ ...raw }] : overrides.map((o) => ({ ...o }));
    const query = {
      select: vi.fn(() => query),
      is: vi.fn((key: string, value: unknown) => { data = data.filter((r) => r[key] === value); return query; }),
      in: vi.fn((key: string, values: string[]) => { data = data.filter((r) => values.includes(r[key])); return query; }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: table === "package_overrides" ? overrideError : null }).then(resolve),
    };
    return query;
  });
  return { from };
}

describe("effective dues messaging client reads", () => {
  it("uses a saved $375 price over raw $0 for queue and balance validation, preserving prior debt", async () => {
    const [client] = await loadDuesClients(db());
    expect(client.package_price).toBe(375);
    expect(isDuesQueueEligible(client)).toBe(true);
    const draft = buildBalanceDraft(client);
    expect(draft.amountDue).toBe(425);
    expect(draft.blocked).toBe(false);
    expect(raw.package_price).toBe(0);
    expect(raw.amount_paid).toBe(0);
  });

  it("uses effective prepared price and explicit early payment in scoped board/send reads", async () => {
    const pending = { ...correction, slot: "pending" as const, status: "prepared" as const,
      price: 200, recognized_paid: 50, total_visits: 4, start_date: "2026-11-16" };
    const [client] = await loadDuesClients(db([correction, pending]), { clientIds: ["c1"], includeDeleted: true });
    const draft = buildRenewalDraft(client);
    expect(draft.amountDue).toBe(150);
    expect(draft.blocked).toBe(false);
    expect(client.pending_renewal_total_visits).toBe(4);
  });

  it("ignores cleared overrides and overrides belonging to other clients", async () => {
    const [client] = await loadDuesClients(db([
      { ...correction, cleared_at: "2026-11-13" },
      { ...correction, client_id: "c2" },
    ]));
    expect(client.package_price).toBe(0);
    expect(isDuesQueueEligible(client)).toBe(false);
    expect(buildBalanceDraft(client).blocked).toBe(true);
  });

  it("fails closed when audited corrections cannot be read", async () => {
    await expect(loadDuesClients(db([], new Error("Correction read denied")))).rejects.toThrow("Correction read denied");
  });

  it("does not make missing consent sendable after the price is corrected", async () => {
    const [client] = await loadDuesClients(db());
    expect(buildBalanceDraft({ ...client, sms_consent_at: null }).blocked).toBe(true);
    expect(buildBalanceDraft({ ...client, sms_opted_out_at: "2026-11-13" }).blocked).toBe(true);
  });

  it("preserves Payment Review for an unexplained overpayment", async () => {
    const [client] = await loadDuesClients(db([{ ...correction, recognized_paid: 500 }]));
    expect(isDuesQueueEligible(client)).toBe(false);
    expect(buildBalanceDraft(client).blocked).toBe(true);
    expect(client.amount_paid).toBe(500);
  });
});