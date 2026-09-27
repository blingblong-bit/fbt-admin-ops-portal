// Server-only: loads Square bookings once and resolves effective visit state
// per Square customer. Read-only — writes nothing anywhere.
import { fetchSquareBookings, type SquareBooking } from "@/lib/schedule.functions";
import {
  resolveEffectiveVisitState,
  type EffectiveVisitState,
  type HubVisitClient,
  type VisitTracking,
  visitTrackingFrom,
} from "@/lib/effective-visit-state";

const DAY = 86_400_000;

export type SquareBookingIndex = {
  nowIso: string;
  byCustomer: Map<string, SquareBooking[]>;
  error: string | null;
};

// Several tiles load this at once. Share one in-flight/recent load per window
// so we don't fire dozens of parallel Square calls (which triggers 429s).
const CACHE_MS = 60_000;
const indexCache = new Map<string, { at: number; p: Promise<SquareBookingIndex> }>();

export function loadSquareBookingIndex(
  token: string,
  pastDays = 180,
  futureDays = 90,
  opts: { fresh?: boolean } = {},
): Promise<SquareBookingIndex> {
  const key = `${pastDays}:${futureDays}`;
  const hit = indexCache.get(key);
  // `fresh` skips the shared copy (user pressed Refresh after editing Square).
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = loadIndexUncached(token, pastDays, futureDays).then((idx) => {
    if (idx.error) indexCache.delete(key); // never cache failures
    return idx;
  });
  indexCache.set(key, { at: Date.now(), p });
  return p;
}

async function loadIndexUncached(token: string, pastDays: number, futureDays: number): Promise<SquareBookingIndex> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const start = nowMs - pastDays * DAY;
  const end = nowMs + futureDays * DAY;
  const chunks: [string, string][] = [];
  for (let s = start; s < end; s += 30 * DAY) {
    chunks.push([new Date(s).toISOString(), new Date(Math.min(s + 30 * DAY, end)).toISOString()]);
  }
  // Limited concurrency (3 at a time) keeps us under Square's burst limit.
  const results: Awaited<ReturnType<typeof fetchSquareBookings>>[] = [];
  for (let i = 0; i < chunks.length; i += 3) {
    results.push(...(await Promise.all(chunks.slice(i, i + 3).map(([a, b]) => fetchSquareBookings(token, a, b)))));
  }
  const failed = results.find((r) => r.error);
  const byCustomer = new Map<string, SquareBooking[]>();
  if (failed) return { nowIso, byCustomer, error: failed.error };
  const seen = new Set<string>();
  for (const r of results) {
    for (const b of r.bookings) {
      if (!b.customer_id || seen.has(b.id)) continue;
      seen.add(b.id);
      const list = byCustomer.get(b.customer_id) ?? [];
      list.push(b);
      byCustomer.set(b.customer_id, list);
    }
  }
  return { nowIso, byCustomer, error: null };
}

export function effectiveStateFor(
  index: SquareBookingIndex,
  client: HubVisitClient & { square_customer_id: string | null },
): EffectiveVisitState {
  const bookings = client.square_customer_id ? (index.byCustomer.get(client.square_customer_id) ?? []) : [];
  return resolveEffectiveVisitState(
    client,
    bookings
      .filter((b) => b.start_at)
      .map((b) => ({
        id: b.id,
        start_at: b.start_at!,
        status: b.status,
        seller_note: b.seller_note,
        customer_note: b.customer_note,
      })),
    index.nowIso,
  );
}

/** Upcoming, non-cancelled appointment starts for a customer, sorted. */
export function upcomingStarts(index: SquareBookingIndex, customerId: string | null): string[] {
  if (!customerId) return [];
  return (index.byCustomer.get(customerId) ?? [])
    .filter((b) => b.start_at && b.start_at >= index.nowIso && !/CANCEL|DECLINE|NO_SHOW/i.test(b.status ?? ""))
    .map((b) => b.start_at!)
    .sort();
}

/**
 * Attach check-in presentation to each client (mutates `visit` only on the
 * in-memory objects). If Square can't be loaded, nothing is attached and every
 * client keeps today's manual check-in behavior.
 */
export async function attachVisitTracking<
  T extends HubVisitClient & { square_customer_id: string | null; visit?: VisitTracking | null },
>(token: string, clients: T[]): Promise<void> {
  const linked = clients.filter((c) => c.square_customer_id && Number(c.package_total_visits ?? 0) > 0);
  if (linked.length === 0) return;
  const index = await loadSquareBookingIndex(token, 180, 60);
  if (index.error) return;
  for (const c of linked) c.visit = visitTrackingFrom(effectiveStateFor(index, c));
}
