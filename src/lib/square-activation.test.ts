import { describe, expect, it } from "vitest";
import { decideSquareActivation } from "./square-activation";
import type { SequenceEntry } from "./square-visit-audit";

const c = { id: "c", square_customer_id: "sq", pending_renewal_start_date: "2026-10-19", pending_renewal_total_visits: 8 };
const e = (date: string, n: number, total = 8, status = "ACCEPTED", past = true): SequenceEntry => ({
  booking_id: `b${date}${n}`, date: `${date}T15:00:00Z`, past, status, cancelled: /CANCEL|NO_SHOW|DECLINED/.test(status), note: { n, total } as never,
});
const run = (seq: SequenceEntry[] | null, o: Partial<{ hasOverride: boolean; currentUnreadable: boolean; sinceYmd: string }> = {}) =>
  decideSquareActivation({ client: c, seq, hasOverride: false, currentUnreadable: false, sinceYmd: "2026-10-01", ...o });

describe("Square-backed prepared-renewal activation", () => {
  it("activates on a past accepted 1/N on/after the prepared date, counting later visits", () => {
    const d = run([e("2026-10-15", 8), e("2026-10-20", 1), e("2026-10-22", 2)]);
    expect(d).toMatchObject({ kind: "activate", startYmd: "2026-10-20", visitsUsed: 2, total: 8 });
  });
  it("never on a future booking", () => expect(run([e("2026-10-30", 1, 8, "ACCEPTED", false)]).kind).toBe("not_ready"));
  it("never on a cancelled or no-show 1/N", () => {
    expect(run([e("2026-10-20", 1, 8, "CANCELLED_BY_CUSTOMER")]).kind).toBe("not_ready");
    expect(run([e("2026-10-20", 1, 8, "NO_SHOW")]).kind).toBe("not_ready");
  });
  it("never before the prepared date or on date alone", () => {
    expect(run([e("2026-10-10", 1)]).kind).toBe("not_ready");
    expect(run([]).kind).toBe("not_ready");
  });
  it("Square errors never activate", () => expect(run(null).kind).toBe("not_ready"));
  it("size mismatch (e.g. 1 of 4 vs prepared 8) is ambiguous", () => expect(run([e("2026-10-20", 1, 4)]).kind).toBe("ambiguous"));
  it("broken numbering after the opener is ambiguous", () => expect(run([e("2026-10-20", 1), e("2026-10-22", 3)]).kind).toBe("ambiguous"));
  it("two openers is ambiguous", () => expect(run([e("2026-10-20", 1), e("2026-10-22", 1)]).kind).toBe("ambiguous"));
  it("unclear current position is ambiguous", () => expect(run([e("2026-10-20", 1)], { currentUnreadable: true }).kind).toBe("ambiguous"));
  it("admin override clients are never touched", () => expect(run([e("2026-10-20", 1)], { hasOverride: true }).kind).toBe("skip"));
  it("openers before the go-live date are backlog only", () => expect(run([e("2026-10-20", 1)], { sinceYmd: "2026-10-24" }).kind).toBe("backlog"));
  it("same evidence gives the same booking boundary (retry hits the renewal boundary guard)", () => {
    const a = run([e("2026-10-20", 1)]), b = run([e("2026-10-20", 1)]);
    expect(a.kind === "activate" && b.kind === "activate" && a.bookingId === b.bookingId).toBe(true);
  });
});
