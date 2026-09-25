// Server-only: loads Square bookings once and resolves effective visit state
// per Square customer. Read-only — writes nothing anywhere.
import { fetchSquareBookings, type SquareBooking } from "@/lib/schedule.functions";
import {
  resolveEffectiveVisitState,
  type EffectiveVisitState,
  type HubVisitClient,
} from "@/lib/effective-visit-state";

const DAY = 86_400_000;

export type SquareBookingIndex = {
  nowIso: string;
  byCustomer: Map<string, SquareBooking[]>;
  error: string | null;
};

export async function loadSquareBookingIndex(
  token: string,
  pastDays = 180,
  futureDays = 90,
): Promise<SquareBookingIndex> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const start = nowMs - pastDays * DAY;
  const end = nowMs + futureDays * DAY;
  const chunks: [string, string][] = [];
  for (let s = start; s < end; s += 30 * DAY) {
    chunks.push([new Date(s).toISOString(), new Date(Math.min(s + 30 * DAY, end)).toISOString()]);
  }
  const results = await Promise.all(chunks.map(([a, b]) => fetchSquareBookings(token, a, b)));
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
