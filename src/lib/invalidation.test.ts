import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { EVENT_KEYS, matchesEvent, invalidateFor, type InvalidationEvent } from "./invalidation";
import { duesFreshness } from "./dues-freshness";

const ALL = Object.keys(EVENT_KEYS) as InvalidationEvent[];

describe("event mappings", () => {
  it("every event refreshes Master Dues (Payment Due, Weekly Dues, dashboard money tiles)", () => {
    for (const e of ALL) expect(matchesEvent(e, ["master-dues"])).toBe(true);
  });
  it("renewal change refreshes Needs Renewal, client list and the client profile", () => {
    expect(matchesEvent("renewal-changed", ["renewal-forecast"])).toBe(true);
    expect(matchesEvent("renewal-changed", ["clients"])).toBe(true);
    expect(matchesEvent("renewal-changed", ["client", "c1"], "c1")).toBe(true);
    expect(matchesEvent("renewal-changed", ["payment-allocations", "c1"], "c1")).toBe(true);
  });
  it("payment change refreshes Square payment queues and payment history", () => {
    for (const k of ["square_payments_needs_review", "square_payments_pending", "square_sync_log", "payment-history-week"])
      expect(matchesEvent("payment-changed", [k])).toBe(true);
  });
  it("check-in refreshes schedule, missed check-ins and dues", () => {
    for (const k of ["schedule-check", "missed-check-ins", "day-review", "completed-visit-bookings", "renewal-forecast", "master-dues"])
      expect(matchesEvent("visit-changed", [k])).toBe(true);
  });
  it("square sync refreshes every money, schedule and profile view", () => {
    for (const k of ["master-dues", "renewal-forecast", "clients", "client", "schedule-check", "missed-check-ins", "scheduled-client-ids", "square_payments_pending"])
      expect(matchesEvent("square-sync", [k, "x"])).toBe(true);
  });
  it("per-client keys narrow to that client only", () => {
    expect(matchesEvent("payment-changed", ["client", "other"], "c1")).toBe(false);
    expect(matchesEvent("payment-changed", ["clients", "deleted"], "c1")).toBe(true);
  });
  it("unrelated keys are left alone", () => {
    expect(matchesEvent("renewal-changed", ["merge-center-pairs"])).toBe(false);
  });
  it("invalidateFor marks matching queries stale and leaves others", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["master-dues"], 1);
    qc.setQueryData(["client", "c2"], 1);
    qc.setQueryData(["merge-center-pairs"], 1);
    await invalidateFor(qc, "renewal-changed", { clientId: "c1" });
    expect(qc.getQueryState(["master-dues"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["client", "c2"])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(["merge-center-pairs"])?.isInvalidated).toBe(false);
  });
});

describe("dues freshness", () => {
  const base = { isPending: false, isFetching: false, isError: false, dataUpdatedAt: 1, hasData: true };
  it("background refresh is 'updating', not untrusted", () => expect(duesFreshness({ ...base, isFetching: true })).toBe("updating"));
  it("failed refresh with old data is 'stale'", () => expect(duesFreshness({ ...base, isError: true })).toBe("stale"));
  it("successful data is 'current'", () => expect(duesFreshness(base)).toBe("current"));
});

// Coverage: no screen may hand-roll a refresh of financial/visit data.
const GUARDED = ["master-dues", "renewal-forecast", "clients", "client", "activities", "payment-allocations", "visit-tracking",
  "unchecked-appointments", "schedule-check", "missed-check-ins", "day-review", "completed-visit-bookings", "scheduled-client-ids",
  "square_payments_needs_review", "square_payments_pending", "square_sync_log", "package_review_dismissals"];

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !n.endsWith(".test.ts") && !p.endsWith("invalidation.ts") && !p.endsWith("routeTree.gen.ts")) out.push(p);
  }
  return out;
}

describe("mutation coverage", () => {
  it("financial/visit refreshes only go through invalidateFor", () => {
    const offenders: string[] = [];
    for (const f of walk(join(process.cwd(), "src"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!/invalidateQueries\(/.test(line) || line.includes("invalidation-ok")) return;
        const m = line.match(/queryKey:\s*\[\s*"([^"]+)"/);
        if (!m || GUARDED.includes(m[1])) offenders.push(`${f}:${i + 1}`);
      });
    }
    // __root.tsx auth recovery (sign-in change / retry errored queries) is not a save.
    expect(offenders.filter((o) => !o.includes("__root.tsx"))).toEqual([]);
  });
  it("each known save point calls invalidateFor", () => {
    const files = ["components/PreRenewCard.tsx", "components/SmartClientCard.tsx", "components/PaymentAllocationsCard.tsx",
      "components/ArchiveClientButton.tsx", "routes/_authenticated/clients.$id.tsx", "routes/_authenticated/schedule-check.tsx",
      "routes/_authenticated/missed-check-ins.tsx", "routes/_authenticated/sync-log.tsx", "routes/_authenticated/clients.new.tsx",
      "routes/_authenticated/clients.deleted.tsx"];
    for (const f of files) expect(readFileSync(join(process.cwd(), "src", f), "utf8")).toMatch(/invalidateFor\(/);
  });
  it("invalidateFor is never called from an error handler", () => {
    for (const f of walk(join(process.cwd(), "src"))) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/onError:[^\n]*invalidateFor/);
      expect(s).not.toMatch(/onSettled:[^\n]*invalidateFor/);
    }
  });
});
