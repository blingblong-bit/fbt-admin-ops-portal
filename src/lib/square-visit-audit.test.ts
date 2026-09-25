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

import { buildSequence, detectNoteIssues, type ReviewBooking } from "./square-visit-audit";

const NOW = "2026-09-24T12:00:00Z";
const rb = (id: string, d: string, note: string | null, status = "ACCEPTED"): ReviewBooking => ({
  id, start_at: `${d}T15:00:00Z`, seller_note: note, status,
});
const kinds = (bs: ReviewBooking[]) => detectNoteIssues(buildSequence(bs, NOW)).map((i) => i.kind);

describe("detectNoteIssues", () => {
  it("clean 3/8 → 4/8 → 5/8 has no flag", () => {
    expect(kinds([rb("1", "2026-09-10", "3/8"), rb("2", "2026-09-17", "4/8"), rb("3", "2026-09-28", "5/8")])).toEqual([]);
  });
  it("3/8 → 5/8 past is a skipped visit", () => {
    expect(kinds([rb("1", "2026-09-10", "3/8"), rb("2", "2026-09-17", "5/8")])).toEqual(["skipped"]);
  });
  it("past 4/8, future 6/8 is stale future numbering", () => {
    const i = detectNoteIssues(buildSequence([rb("1", "2026-09-17", "4/8"), rb("2", "2026-09-28", "6/8")], NOW));
    expect(i[0].kind).toBe("stale_future");
    expect(i[0].expected).toBe("5/8");
  });
  it("5/8 → 4/8 goes backward", () => {
    expect(kinds([rb("1", "2026-09-10", "5/8"), rb("2", "2026-09-17", "4/8")])).toEqual(["backward"]);
  });
  it("8/8 → 1/8 is a valid renewal", () => {
    expect(kinds([rb("1", "2026-09-10", "7/8"), rb("2", "2026-09-15", "8/8"), rb("3", "2026-09-17", "1/8"), rb("4", "2026-09-29", "2/8")])).toEqual([]);
  });
  it("renewal into a different package size is fine", () => {
    expect(kinds([rb("1", "2026-09-10", "8/8"), rb("2", "2026-09-17", "1/10")])).toEqual([]);
  });
  it("conflicting same-day notes are flagged", () => {
    expect(kinds([rb("1", "2026-09-17", "4/8"), rb("2", "2026-09-17", "6/8")])).toEqual(["same_day_conflict"]);
  });
  it("5/8 → 6/10 without renewal is a package-size flag", () => {
    expect(kinds([rb("1", "2026-09-10", "5/8"), rb("2", "2026-09-17", "6/10")])).toEqual(["package_size"]);
  });
  it("no Square notes at all is not flagged", () => {
    expect(kinds([rb("1", "2026-09-10", null), rb("2", "2026-09-17", "knee")])).toEqual([]);
  });
  it("missing note inside an otherwise clear sequence is flagged", () => {
    expect(kinds([rb("1", "2026-09-10", "3/8"), rb("2", "2026-09-14", null), rb("3", "2026-09-17", "5/8")])).toEqual(["missing_note"]);
  });
  it("a cancelled 4/8 rebooked as 4/8 is not flagged", () => {
    expect(kinds([rb("1", "2026-09-10", "3/8"), rb("2", "2026-09-14", "4/8", "CANCELLED_BY_SELLER"), rb("3", "2026-09-17", "4/8")])).toEqual([]);
  });
});

describe("cancelled bookings stay in the sequence", () => {
  const rb = (id: string, d: string, note: string, status = "ACCEPTED") => ({ id, start_at: `${d}T15:00:00Z`, seller_note: note, status });
  const issues = (xs: ReturnType<typeof rb>[]) => detectNoteIssues(buildSequence(xs, now)).map((i) => i.kind);
  it("6/8 → 7/8 cancelled → 8/8 is valid", () => {
    expect(issues([rb("a", "2026-09-01", "6/8"), rb("b", "2026-09-08", "7/8", "CANCELLED_BY_SELLER"), rb("c", "2026-09-15", "8/8")])).toEqual([]);
  });
  it("6/8 → 8/8 with no 7/8 is skipped", () => {
    expect(issues([rb("a", "2026-09-01", "6/8"), rb("c", "2026-09-15", "8/8")])).toEqual(["skipped"]);
  });
  it("5/8 → 4/8 is backward", () => {
    expect(issues([rb("a", "2026-09-01", "5/8"), rb("c", "2026-09-15", "4/8")])).toEqual(["backward"]);
  });
  it("8/8 → 1/8 is a renewal", () => {
    expect(issues([rb("a", "2026-09-01", "8/8"), rb("c", "2026-09-15", "1/8")])).toEqual([]);
  });
  it("cancelled un-noted booking is not a missing note", () => {
    expect(issues([rb("a", "2026-09-01", "6/8"), rb("b", "2026-09-08", "", "NO_SHOW"), rb("c", "2026-09-15", "8/8")])).toEqual(["skipped"]);
  });
});

describe("rebooked cancelled visits", () => {
  const rb = (id: string, d: string, note: string, status = "ACCEPTED") => ({ id, start_at: `${d}T15:00:00Z`, seller_note: note, status });
  it("7/8 cancelled then 7/8 rebooked is not flagged", () => {
    expect(detectNoteIssues(buildSequence([rb("a", "2026-09-01", "6/8"), rb("b", "2026-09-08", "7/8", "CANCELLED_BY_SELLER"), rb("c", "2026-09-10", "7/8"), rb("d", "2026-09-15", "8/8")], now))).toEqual([]);
  });
});

describe("cancelled visit is not hidden by an older package", () => {
  const rb = (id: string, d: string, note: string, status = "ACCEPTED") => ({ id, start_at: `${d}T15:00:00Z`, seller_note: note, status });
  it("older live 7/8 does not supersede a new cancelled 7/8", () => {
    expect(detectNoteIssues(buildSequence([rb("o", "2026-06-01", "7/8"), rb("p", "2026-06-08", "8/8"), rb("q", "2026-06-15", "1/8"), rb("r", "2026-07-01", "2/8"), rb("s", "2026-07-10", "3/8"), rb("t", "2026-07-20", "4/8"), rb("u", "2026-08-01", "5/8"), rb("a", "2026-09-01", "6/8"), rb("b", "2026-09-08", "7/8", "CANCELLED_BY_SELLER"), rb("d", "2026-09-15", "8/8")], now))).toEqual([]);
  });
});
