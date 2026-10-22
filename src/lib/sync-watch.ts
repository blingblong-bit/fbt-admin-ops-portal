/**
 * Decide whether a newer Square sync entry should reload open screens.
 * First observation only records a baseline (screens just loaded fresh data).
 * A newer entry inside the throttle gap is left unseen so it fires once the gap passes.
 */
export function shouldRefreshForSync(
  seen: string | null,
  latest: string,
  lastRefreshAt: number,
  now: number,
  minGapMs: number,
): { refresh: boolean; markSeen: boolean } {
  if (seen === null) return { refresh: false, markSeen: true };
  if (Date.parse(latest) <= Date.parse(seen)) return { refresh: false, markSeen: false };
  if (now - lastRefreshAt < minGapMs) return { refresh: false, markSeen: false };
  return { refresh: true, markSeen: true };
}
