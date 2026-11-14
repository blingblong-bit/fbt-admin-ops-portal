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
  it("worklist search preserves a client's memberships and leaves original lists intact", () => {
    const krislyn = { id: "krislyn", first_name: "Krislyn", last_name: "Martin" };
    const other = { id: "other", first_name: "Katie", last_name: "McNabb" };
    const categories = { not_scheduled: [krislyn, other], package_completed: [krislyn], hidden: [other] };
    const getName = (r: typeof krislyn) => `${r.first_name} ${r.last_name}`;
    expect(filterByName(categories.not_scheduled, "  KRIS ", getName)).toEqual([krislyn]);
    expect(filterByName(categories.package_completed, "mart", getName)).toEqual([krislyn]);
    expect(filterByName(categories.hidden, "kris", getName)).toEqual([]);
    expect(categories.not_scheduled).toEqual([krislyn, other]);
    expect(filterByName(categories.not_scheduled, "", getName)).toBe(categories.not_scheduled);
  });
});
