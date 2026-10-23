import { describe, expect, it } from "vitest";
import { filterByName, nameMatches } from "./name-search";

describe("name search", () => {
  it("is case-insensitive and partial", () => {
    expect(nameMatches("Krislyn Martin", "kris")).toBe(true);
    expect(nameMatches("Krislyn Martin", "MART")).toBe(true);
  });
  it("trims and collapses spaces, matches parts in any order", () => {
    expect(nameMatches("Krislyn Martin", "  martin   kris ")).toBe(true);
  });
  it("rejects non-matches", () => {
    expect(nameMatches("Krislyn Martin", "brody")).toBe(false);
  });
  it("empty query returns the same list untouched", () => {
    const list = [{ n: "A" }, { n: "B" }];
    expect(filterByName(list, "   ", (x) => x.n)).toBe(list);
  });
});
