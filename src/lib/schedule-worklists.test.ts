import { describe, expect, it } from "vitest";
import { classifyWorklist, type ManualHide, type WorklistClient } from "./schedule-worklists";

const vt = (mode: "square" | "square_review", used: number, total = 8) => ({
  mode, used, total, lastVisitDate: null, nextNote: null, nextDate: null, manualCheckInNeeded: false, reason: "",
});
const c = (over: Partial<WorklistClient> = {}): WorklistClient => ({
  id: "x", status: "active", package_total_visits: 8, visits_used: 2, package_start_date: "2026-06-01", ...over,
});
const f = (lastKeptYmd: string | null, futureLiveIds: string[] = [], thisWeekLiveCount = 0) => ({
  lastKeptYmd, futureLiveIds, thisWeekLiveCount,
});
const TODAY = "2026-10-24";
const hide = (over: Partial<ManualHide> = {}): ManualHide => ({
  id: "h", hidden_at: "2026-10-20T00:00:00Z", reason: "Moved away", known_future_booking_ids: [],
  package_start_snapshot: "2026-06-01", pending_renewal_snapshot: null, ...over,
});

describe("schedule worklists", () => {
  it("Maddox (Square 6/8, last visit Oct 22, nothing booked) is Not Scheduled using Square, no Hub flag", () => {
    const r = classifyWorklist(c({ visits_used: 0, visit: vt("square", 6) }), f("2026-10-22"), TODAY, null);
    expect(r.list).toBe("not_scheduled");
    expect(r.left).toBe(2);
    expect(r.check).toBeNull();
  });

  it("21 similar last-week clients all stay in Not Scheduled after the Saturday rollover and on Monday", () => {
    for (const day of ["2026-10-24", "2026-10-26"]) {
      const lists = Array.from({ length: 21 }, (_, i) =>
        classifyWorklist(c({ id: `c${i}` }), f(`2026-10-${19 + (i % 5)}`), day, null).list,
      );
      expect(lists.every((l) => l === "not_scheduled")).toBe(true);
    }
  });

  it("last seen over 60 days ago is auto-hidden; new package even if old visit stays Not Scheduled", () => {
    expect(classifyWorklist(c(), f("2026-08-01"), TODAY, null)).toMatchObject({ list: "hidden", hiddenKind: "auto" });
    expect(classifyWorklist(c({ package_start_date: "2026-10-10" }), f("2026-08-01"), TODAY, null).list).toBe("not_scheduled");
  });

  it("Square notes needing review are never auto-hidden", () => {
    const r = classifyWorklist(c({ visits_used: 8, visit: vt("square_review", 3) }), f("2026-07-01"), TODAY, null);
    expect(r.list).toBe("not_scheduled");
  });

  it("exactly one live appointment this week → Only Once; two → no task", () => {
    expect(classifyWorklist(c(), f("2026-10-20", ["b1"], 1), TODAY, null).list).toBe("only_once");
    expect(classifyWorklist(c(), f("2026-10-20", ["b1", "b2"], 2), TODAY, null).list).toBeNull();
  });

  it("Package Completed outranks Not Scheduled and Only Once", () => {
    expect(classifyWorklist(c({ visits_used: 8 }), f("2026-10-22"), TODAY, null).list).toBe("package_completed");
    expect(classifyWorklist(c({ visits_used: 8 }), f("2026-10-22", ["b"], 1), TODAY, null).list).toBe("package_completed");
  });

  it("prepared next package means not completed", () => {
    expect(classifyWorklist(c({ visits_used: 8, pending_renewal_start_date: "2026-10-27" }), f("2026-10-22"), TODAY, null).list)
      .toBe("not_scheduled");
  });

  it("manual hide persists across weeks and over pre-existing bookings", () => {
    const h = hide({ known_future_booking_ids: ["old"] });
    expect(classifyWorklist(c(), f("2026-10-22"), TODAY, h)).toMatchObject({ list: "hidden", hiddenKind: "manual" });
    expect(classifyWorklist(c(), f("2026-10-22"), "2026-11-09", h).list).toBe("hidden");
    expect(classifyWorklist(c(), f("2026-10-22", ["old"], 1), TODAY, h).list).toBe("hidden");
  });

  it("a new booking clears the hide and re-evaluates (single booking → Only Once)", () => {
    const r = classifyWorklist(c(), f("2026-10-22", ["new"], 1), TODAY, hide());
    expect(r.clearHide).toBe("New appointment booked");
    expect(r.list).toBe("only_once");
  });

  it("a new package clears the hide; no booking → Not Scheduled", () => {
    const r = classifyWorklist(c({ package_start_date: "2026-10-23" }), f("2026-08-01"), TODAY, hide());
    expect(r.clearHide).toBe("New package started");
    expect(r.list).toBe("not_scheduled");
    const p = classifyWorklist(c({ pending_renewal_start_date: "2026-10-30" }), f("2026-10-01"), TODAY, hide());
    expect(p.clearHide).toBe("New package purchased");
  });

  it("manual hide is not applied when Square notes need review", () => {
    const r = classifyWorklist(c({ visits_used: 0, visit: vt("square_review", 6) }), f("2026-10-22"), TODAY, hide());
    expect(r.list).toBe("not_scheduled");
    expect(r.reasons.join(" ")).toMatch(/needs review/);
  });

  it("archived, inactive and no-package clients are in no list", () => {
    expect(classifyWorklist(c({ status: "archived" }), f("2026-10-22"), TODAY, null).list).toBeNull();
    expect(classifyWorklist(c({ status: "inactive" }), f("2026-10-22"), TODAY, null).list).toBeNull();
    expect(classifyWorklist(c({ package_total_visits: 0 }), f("2026-10-22"), TODAY, null).list).toBeNull();
  });

  it("staff restore (pin) keeps an auto-hidden client visible across weeks until new activity", () => {
    const pin = hide({ kind: "pin", reason: "Restored by staff" });
    const r = classifyWorklist(c(), f("2026-08-01"), TODAY, pin);
    expect(r).toMatchObject({ list: "not_scheduled", pinned: true });
    expect(classifyWorklist(c(), f("2026-08-01"), "2026-11-16", pin).list).toBe("not_scheduled");
    const n = classifyWorklist(c(), f("2026-08-01", ["new"], 1), TODAY, pin);
    expect(n.clearPin).toBe("New appointment booked");
    expect(n.list).toBe("only_once");
    expect(classifyWorklist(c(), f("2026-08-01"), TODAY, null).list).toBe("hidden");
  });

  it("unlinked Square clients are never auto-hidden from missing history", () => {
    const r = classifyWorklist(c(), { ...f(null), sourceUnknown: true }, TODAY, null);
    expect(r.list).toBe("not_scheduled");
    expect(r.reasons[0]).toMatch(/Not linked to Square/);
  });
});
