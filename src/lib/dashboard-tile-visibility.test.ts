import { describe, expect, it } from "vitest";
import { visibleTileMoney } from "./dashboard-tile-visibility";

describe("visibleTileMoney", () => {
  const amounts = { money: 375, extraMoney: 425 };

  it("hides both tile amount fields from staff", () => {
    expect(visibleTileMoney(amounts, true)).toEqual({});
  });

  it("keeps both tile amount fields for admins", () => {
    expect(visibleTileMoney(amounts, false)).toEqual(amounts);
  });
});