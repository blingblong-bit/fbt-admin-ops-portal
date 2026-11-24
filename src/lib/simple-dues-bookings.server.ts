import type { SquareBooking } from "./schedule.functions";

type BookingResult = { bookings: SquareBooking[]; error: string | null };
type BookingReader = (token: string, start: string, end: string, customerId?: string) => Promise<BookingResult>;
const DAY = 86400000;
export const SIMPLE_BOOKING_CACHE_MS = 3 * 60000;

/** Preserve chronological accumulation/first failure, regardless of completion order. */
export async function fetchSimpleBookingWindows(
  fetchSquareBookings: BookingReader, token: string, startIso: string, endIso: string, customerId?: string,
): Promise<BookingResult> {
  const windows: { start: string; end: string }[] = [];
  let start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  while (start < end && windows.length < 121) {
    const next = Math.min(start + 28 * DAY, end);
    windows.push({ start: new Date(start).toISOString(), end: new Date(next).toISOString() });
    start = next;
  }
  const bookings: SquareBooking[] = [];
  for (let offset = 0; offset < windows.length; offset += 4) {
    // Settle the whole batch so a later failure cannot outrank an earlier one.
    const results = await Promise.all(windows.slice(offset, offset + 4).map(async window => {
      try {
        return { kind: "result" as const, value: await fetchSquareBookings(token, window.start, window.end, customerId) };
      } catch (error) {
        return { kind: "throw" as const, error };
      }
    }));
    for (const result of results) {
      if (result.kind === "throw") throw result.error;
      if (result.value.error || result.value.bookings.length >= 2000) {
        return { bookings, error: result.value.error ?? "Appointment history is incomplete" };
      }
      // Keep duplicates and order as before; the existing reader/calculator owns dedupe.
      bookings.push(...result.value.bookings);
    }
  }
  return { bookings, error: start < end ? "Appointment history is too large; manual review needed" : null };
}

/** Resolved raw bookings only: no user records, package state, balances or in-flight I/O. */
export function createSimpleBookingCache() {
  const entries = new Map<string, { end: number; expires: number; token: string; result: BookingResult }>();
  return async function read(input: {
    reader: BookingReader; token: string; scope: string; startIso: string; endIso: string;
    customerId?: string; forceFresh?: boolean;
  }): Promise<BookingResult> {
    const now = Date.now();
    for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
    const end = new Date(input.endIso).getTime();
    const key = JSON.stringify([input.scope, input.customerId ?? null, input.startIso]);
    const cached = entries.get(key);
    // The rolling 90-day endpoint moves with the clock. Reuse its original range
    // only within the freshness window, never for a different historical start.
    if (!input.forceFresh && cached && cached.token === input.token && Math.abs(end - cached.end) < SIMPLE_BOOKING_CACHE_MS) {
      return structuredClone(cached.result);
    }
    // A failed forced refresh must not leave a successful old entry available.
    entries.delete(key);
    const result = await fetchSimpleBookingWindows(input.reader, input.token, input.startIso, input.endIso, input.customerId);
    if (!result.error) {
      if (entries.size >= 20) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { end, expires: Date.now() + SIMPLE_BOOKING_CACHE_MS, token: input.token, result: structuredClone(result) });
    }
    return result;
  };
}

export const readSimpleBookings = createSimpleBookingCache();