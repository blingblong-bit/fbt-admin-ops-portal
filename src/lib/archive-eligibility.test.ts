import { describe, expect, it } from "vitest";
import {
  ARCHIVE_BLOCKED_SCHEDULED,
  ARCHIVE_BLOCKED_UNVERIFIED,
  archiveUpdatePayload,
  decideArchive,
} from "./archive-eligibility";

const now = new Date("2026-10-13T17:00:00Z");

describe("archive eligibility", () => {
  it("no upcoming appointment → allowed", () => {
    expect(decideArchive(true, [], now).allowed).toBe(true);
  });
  it("future accepted appointment → blocked", () => {
    const d = decideArchive(true, [{ start_at: "2026-10-20T15:00:00Z", status: "ACCEPTED" }], now);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(ARCHIVE_BLOCKED_SCHEDULED);
  });
  it("future cancelled/declined/no-show only → allowed", () => {
    const d = decideArchive(
      true,
      [
        { start_at: "2026-10-20T15:00:00Z", status: "CANCELLED_BY_CUSTOMER" },
        { start_at: "2026-10-21T15:00:00Z", status: "CANCELLED_BY_SELLER" },
        { start_at: "2026-10-22T15:00:00Z", status: "DECLINED" },
        { start_at: "2026-10-23T15:00:00Z", status: "NO_SHOW" },
      ],
      now,
    );
    expect(d.allowed).toBe(true);
  });
  it("past appointment earlier today only → allowed", () => {
    const d = decideArchive(true, [{ start_at: "2026-10-13T14:00:00Z", status: "ACCEPTED" }], now);
    expect(d.allowed).toBe(true);
  });
  it("unverifiable Square schedule → blocked", () => {
    const d = decideArchive(false, [], now);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(ARCHIVE_BLOCKED_UNVERIFIED);
  });
  it("archived client retains all historical data (only status is written)", () => {
    const client = {
      status: "active",
      package_total_visits: 8,
      visits_used: 5,
      amount_paid: 300,
      square_customer_id: "SQ123",
      previous_package_owed: 50,
      pending_renewal_start_date: "2026-11-01",
    };
    const payload = archiveUpdatePayload(true);
    expect(Object.keys(payload)).toEqual(["status"]);
    const after = { ...client, ...payload };
    expect(after).toEqual({ ...client, status: "archived" });
    expect({ ...after, ...archiveUpdatePayload(false) }).toEqual({ ...client, status: "active" });
  });
});
