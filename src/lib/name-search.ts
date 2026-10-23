/** Display-only client-name filter. Never used for totals or grouping. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export function nameMatches(name: string | null | undefined, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const n = normalizeQuery(name ?? "");
  return n.includes(q) || q.split(" ").every((part) => n.includes(part));
}

export function filterByName<T>(items: T[], query: string, getName: (t: T) => string | null | undefined): T[] {
  if (!normalizeQuery(query)) return items;
  return items.filter((i) => nameMatches(getName(i), query));
}
