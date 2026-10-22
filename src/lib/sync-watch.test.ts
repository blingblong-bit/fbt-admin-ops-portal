import { describe, it, expect } from "vitest";
import { shouldRefreshForSync } from "./sync-watch";

const A = "2026-10-22T04:00:00Z";
const B = "2026-10-22T04:05:00Z";

describe("background Square sync refresh", () => {
  it("first check only sets a baseline", () => expect(shouldRefreshForSync(null, A, 0, 1e9, 60_000)).toEqual({ refresh: false, markSeen: true }));
  it("no new sync, no reload", () => expect(shouldRefreshForSync(A, A, 0, 1e9, 60_000).refresh).toBe(false));
  it("new sync reloads open screens", () => expect(shouldRefreshForSync(A, B, 0, 1e9, 60_000)).toEqual({ refresh: true, markSeen: true }));
  it("throttled to once a minute, but not lost", () => {
    expect(shouldRefreshForSync(A, B, 1e9 - 30_000, 1e9, 60_000)).toEqual({ refresh: false, markSeen: false });
    expect(shouldRefreshForSync(A, B, 1e9 - 61_000, 1e9, 60_000).refresh).toBe(true);
  });
});
