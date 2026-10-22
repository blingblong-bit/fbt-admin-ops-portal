// Tells money screens whether their numbers are current, being refreshed in
// the background (still trusted), or out of date (last refresh failed).
export type Freshness = "loading" | "current" | "updating" | "stale";

export function duesFreshness(q: {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  hasData: boolean;
}): Freshness {
  if (!q.hasData) return "loading";
  if (q.isError) return q.isFetching ? "updating" : "stale"; // retrying a failed refresh still counts as untrusted until it lands
  if (q.isFetching) return "updating";
  return "current";
}

/** True when the numbers on screen must be dimmed and not treated as current. */
export const isUntrusted = (f: Freshness, isErrorWithData: boolean) => f === "stale" || isErrorWithData;

export function lastUpdatedLabel(dataUpdatedAt: number, computedAt?: string | null): string {
  const t = computedAt ? Date.parse(computedAt) : dataUpdatedAt;
  if (!t || Number.isNaN(t)) return "unknown";
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}
