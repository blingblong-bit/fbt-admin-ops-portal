/** Split a list into batches so long ".in(...)" lookups stay under URL limits. */
export function chunk<T>(list: T[], size: number): T[][] {
  if (size <= 0) throw new Error("size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
