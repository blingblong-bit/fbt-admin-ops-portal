import { describe, expect, it } from "vitest";
import { classifyClient, parseBookings, parseVisitNote } from "./square-visit-audit";

describe("parseVisitNote", () => {
  it("recognizes common formats", () => {
    expect(parseVisitNote("5 of 8")).toEqual({ n: 5, total: 8 });
    expect(parseVisitNote("5/8")).toEqual({ n: 5, total: 8 });
    expect(parseVisitNote("Visit 5 of 8")).toEqual({ n: 5, total: 8 });
    expect(parseVisitNote("paid, visit 5/8 knee")).toEqual({ n: 5, total: 8 });
  });
  it("refuses ambiguous or invalid notes", () => {
    expect(parseVisitNote("5/8 or 6/8")).toBeNull();
    expect(parseVisitNote("9 of 8")).toBeNull();
    expect(parseVisitNote("knee")).toBeNull();
    expect(parseVisitNote(null)).toBeNull();
  });
});

const now = "2026-09-24T12:00:00Z";
const b = (id: string, d: string, note: string) => ({ id, start_at: `${d}T15:00:00Z`, seller_note: note });

describe("classifyClient", () => {
  it("synced when latest past matches and future continues", () => {
    const p = parseBookings([b("1", "2026-09-20", "4/8"), b("2", "2026-09-22", "5/8"), b("3", "2026-09-27", "6/8")], now);
    expect(classifyClient(5, 8, p).classification).toBe("Square synced");
  });
  it("review when Square ahead", () => {
    const p = parseBookings([b("1", "2026-09-20", "5/8"), b("2", "2026-09-22", "6/8")], now);
    expect(classifyClient(4, 8, p).reason).toMatch(/ahead by 2/);
  });
  it("review on skip and package size mismatch", () => {
    expect(classifyClient(6, 8, parseBookings([b("1", "2026-09-20", "4/8"), b("2", "2026-09-22", "6/8")], now)).classification).toBe("Needs review");
    expect(classifyClient(5, 8, parseBookings([b("1", "2026-09-20", "4/10"), b("2", "2026-09-22", "5/10")], now)).pattern).toBe("total_mismatch");
  });
  it("wraps to a new package", () => {
    const p = parseBookings([b("1", "2026-09-20", "8/8"), b("2", "2026-09-27", "1/8")], now);
    expect(classifyClient(8, 8, p).classification).toBe("Square synced");
  });
  it("fallback with no or isolated notes", () => {
    expect(classifyClient(3, 8, []).classification).toBe("Hub fallback");
    expect(classifyClient(3, 8, parseBookings([b("1", "2026-09-20", "3/8")], now)).pattern).toBe("isolated_note");
  });
});
