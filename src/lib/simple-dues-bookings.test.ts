import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimpleBookingCache, fetchSimpleBookingWindows, SIMPLE_BOOKING_CACHE_MS } from "./simple-dues-bookings.server";
import type { SquareBooking } from "./schedule.functions";

type Result = { bookings: SquareBooking[]; error: string | null };
type Reader = (token: string, start: string, end: string, customerId?: string) => Promise<Result>;
const DAY = 86400000;
const start = "2026-01-01T00:00:00.000Z";
const end = new Date(new Date(start).getTime() + 28 * DAY * 9 + DAY).toISOString();
const booking = (id: string): SquareBooking => ({ id, customer_id: "customer", start_at: start, status: "ACCEPTED", appointment_segments: [{ duration_minutes: 45 }] });

// Original loop, intentionally independent of the concurrent implementation.
async function sequential(reader: Reader, until = end): Promise<Result> {
  const bookings: SquareBooking[] = [];
  let from = new Date(start);
  for (let windows = 0; from < new Date(until); windows++) {
    if (windows > 120) return { bookings, error: "Appointment history is too large; manual review needed" };
    const next = new Date(Math.min(from.getTime() + 28 * DAY, new Date(until).getTime()));
    const result = await reader("test-token", from.toISOString(), next.toISOString(), "customer");
    if (result.error || result.bookings.length >= 2000) return { bookings, error: result.error ?? "Appointment history is incomplete" };
    bookings.push(...result.bookings);
    from = next;
  }
  return { bookings, error: null };
}

afterEach(() => vi.useRealTimers());
describe("bounded simple dues booking reads", () => {
  it("matches sequential windows, ordering and duplicates even with out-of-order responses; maximum four reads", async () => {
    let active = 0;
    let peak = 0;
    const mockFetchSquareBookings = vi.fn<Reader>(async (_token, from) => {
      active++;
      peak = Math.max(peak, active);
      const index = (new Date(from).getTime() - new Date(start).getTime()) / (28 * DAY);
      await new Promise(resolve => setTimeout(resolve, (4 - index % 4) * 2));
      active--;
      return { bookings: [booking(String(index)), booking("boundary-duplicate")], error: null };
    });
    const actual = await fetchSimpleBookingWindows(mockFetchSquareBookings, "test-token", start, end, "customer");
    const calls = [...mockFetchSquareBookings.mock.calls];
    const expected = await sequential(mockFetchSquareBookings);
    expect(actual).toEqual(expected);
    expect(actual.bookings).toHaveLength(20);
    expect(calls).toEqual(mockFetchSquareBookings.mock.calls.slice(10));
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });
  it.each([0, 2, 3, 4, 9])("preserves partial history and first error for failed window %s", async failed => {
    const reader = vi.fn<Reader>(async (_token, from) => {
      const index = (new Date(from).getTime() - new Date(start).getTime()) / (28 * DAY);
      return { bookings: [booking(String(index))], error: index >= failed ? `failure ${index}` : null };
    });
    expect(await fetchSimpleBookingWindows(reader, "test-token", start, end, "customer")).toEqual(await sequential(reader));
  });
  it("preserves the 2,000-booking truncation guard without including that window", async () => {
    const reader = vi.fn<Reader>(async (_token, from) => ({ bookings: from === start ? [booking("first")] : Array.from({ length: 2000 }, (_, i) => booking(String(i))), error: null }));
    expect(await fetchSimpleBookingWindows(reader, "test-token", start, end, "customer")).toEqual(await sequential(reader));
  });
  it("preserves the original 121-window limit and partial bookings", async () => {
    const until = new Date(new Date(start).getTime() + 28 * DAY * 122).toISOString();
    const reader = vi.fn<Reader>(async (_token, from) => ({ bookings: [booking(from)], error: null }));
    const actual = await fetchSimpleBookingWindows(reader, "test-token", start, until, "customer");
    expect(reader).toHaveBeenCalledTimes(121);
    expect(actual).toEqual(await sequential(reader, until));
    expect(actual.bookings).toHaveLength(121);
  });
  it("a window error outranks the history guard", async () => {
    const until = new Date(new Date(start).getTime() + 28 * DAY * 122).toISOString();
    const reader = vi.fn<Reader>(async () => ({ bookings: [], error: "unavailable" }));
    expect(await fetchSimpleBookingWindows(reader, "test-token", start, until)).toEqual({ bookings: [], error: "unavailable" });
  });
  it("retains thrown-error behavior but ignores throws after the first chronological window error", async () => {
    const thrown = vi.fn<Reader>().mockRejectedValue(new Error("unexpected"));
    await expect(fetchSimpleBookingWindows(thrown, "test-token", start, end)).rejects.toThrow("unexpected");
    const reader = vi.fn<Reader>(async (_token, from) => {
      if (from !== start) throw new Error("later");
      return { bookings: [], error: "first" };
    });
    expect(await fetchSimpleBookingWindows(reader, "test-token", start, end)).toEqual(await sequential(reader));
  });
});

describe("bookings-only three-minute cache", () => {
  function fixture() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T03:00:00Z"));
    const read = createSimpleBookingCache();
    const reader = vi.fn<Reader>().mockResolvedValue({ bookings: [booking("original")], error: null });
    const input = { reader, token: "test-token", scope: "admin-one", startIso: start, endIso: new Date(new Date(start).getTime() + DAY).toISOString(), customerId: "customer" };
    return { read, reader, input };
  }
  it("reuses raw bookings for three minutes, including the rolling endpoint, then expires", async () => {
    const { read, reader, input } = fixture();
    const first = await read(input);
    vi.advanceTimersByTime(SIMPLE_BOOKING_CACHE_MS - 1);
    expect(await read({ ...input, endIso: new Date(new Date(input.endIso).getTime() + SIMPLE_BOOKING_CACHE_MS - 1).toISOString() })).toEqual(first);
    expect(reader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await read(input);
    expect(reader).toHaveBeenCalledTimes(2);
  });
  it("Refresh/Retry bypasses and replaces cached bookings", async () => {
    const { read, reader, input } = fixture();
    await read(input);
    reader.mockResolvedValue({ bookings: [booking("fresh")], error: null });
    expect((await read({ ...input, forceFresh: true })).bookings[0]?.id).toBe("fresh");
    expect((await read(input)).bookings[0]?.id).toBe("fresh");
    expect(reader).toHaveBeenCalledTimes(2);
  });
  it("failed forced refresh evicts old data and is never cached", async () => {
    const { read, reader, input } = fixture();
    await read(input);
    reader.mockResolvedValue({ bookings: [], error: "Square offline" });
    expect((await read({ ...input, forceFresh: true })).error).toBe("Square offline");
    expect((await read(input)).error).toBe("Square offline");
    expect(reader).toHaveBeenCalledTimes(3);
  });
  it.each(["scope", "customerId", "startIso", "token", "endIso"] as const)("does not reuse a different %s", async field => {
    const { read, reader, input } = fixture();
    await read(input);
    const value = field === "startIso" ? "2026-01-02T00:00:00.000Z" : field === "endIso" ? "2026-01-03T00:00:00.000Z" : "different";
    await read({ ...input, [field]: value });
    // start=end is an empty range, still must not return the old booking.
    if (field === "startIso") expect((await read({ ...input, startIso: value })).bookings).toEqual([]);
    else expect(reader).toHaveBeenCalledTimes(2);
  });
  it("returned objects cannot mutate the cached raw data", async () => {
    const { read, input } = fixture();
    const first = await read(input);
    first.bookings[0]?.appointment_segments?.splice(0);
    expect((await read(input)).bookings[0]?.appointment_segments).toEqual([{ duration_minutes: 45 }]);
  });
});