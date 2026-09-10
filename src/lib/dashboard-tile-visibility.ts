export type TileMoney = {
  money?: number;
  extraMoney?: number;
};

/**
 * Staff may use operational dashboard tiles, but aggregate dollar amounts are
 * reserved for admin and superadmin accounts.
 */
export function visibleTileMoney(values: TileMoney, hideMoney: boolean): TileMoney {
  if (hideMoney) return {};
  return values;
}