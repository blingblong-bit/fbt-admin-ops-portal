import { describe, expect, it } from "vitest";
import type { Client } from "./clients";
import { groupWeeklyPayments, type WeeklyRenewalForecast } from "./weekly-payment-groups";

function client(id: string, price: number, paid: number): Client {
  return {
    id,
    first_name: id,
    last_name: "Client",
    phone: null,
    email: null,
    package_name: "Package",
    package_total_visits: 8,
    package_price: price,
    next_package_price: null,
    package_start_date: "2026-09-01",
    visits_used: 7,
    amount_paid: paid,
    internal_notes: null,
    square_visit_note: null,
    status: "active",
    manual_active: false,
    square_customer_id: null,
    payment_model: "package",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    deleted_at: null,
  };
}

function forecast(clientId: string, preRenewed: boolean, price: number): WeeklyRenewalForecast {
  return {
    client_id: clientId,
    week_bucket: "next",
    next_package_price: price,
    pre_renewed: preRenewed,
    first_uncovered_ymd: "2026-09-16",
    pending_start_ymd: preRenewed ? "2026-09-16" : null,
  };
}

describe("groupWeeklyPayments", () => {
  it("separates current, scheduled, and unprepared renewal amounts", () => {
    const clients = [client("both", 400, 200), client("scheduled", 375, 375), client("needs", 345, 345)];
    const forecasts = new Map([
      ["both", forecast("both", true, 375)],
      ["scheduled", forecast("scheduled", true, 425)],
      ["needs", forecast("needs", false, 345)],
    ]);

    const groups = groupWeeklyPayments(clients, forecasts, "next", (c) => c.id === "both");

    expect(groups.current.map((row) => row.client.id)).toEqual(["both"]);
    expect(groups.renewalScheduled.map((row) => row.client.id)).toEqual(["both", "scheduled"]);
    expect(groups.needsRenewal.map((row) => row.client.id)).toEqual(["needs"]);
    expect(groups.totals).toEqual({
      current: 200,
      renewalScheduled: 800,
      needsRenewal: 345,
      nextPackage: 1145,
      combined: 1345,
    });
  });

  it("ignores renewal forecasts outside the selected week", () => {
    const c = client("later", 375, 375);
    const later = { ...forecast("later", false, 375), week_bucket: "later" as const };
    const groups = groupWeeklyPayments([c], new Map([[c.id, later]]), "next", () => false);

    expect(groups.needsRenewal).toEqual([]);
    expect(groups.totals.combined).toBe(0);
  });
});