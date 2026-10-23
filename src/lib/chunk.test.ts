import { describe, expect, it } from "vitest";
import { chunk } from "./chunk";

describe("chunk", () => {
  it("splits 250 ids into batches of 100, 100, 50 without losing any", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const parts = chunk(ids, 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
    expect(parts.flat()).toEqual(ids);
  });
  it("returns no batches for an empty list", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});
