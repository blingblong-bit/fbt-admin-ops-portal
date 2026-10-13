import type { ArchiveBooking } from "./archive-eligibility";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";
const WINDOW_DAYS = 31; // Square list-bookings max window
const WINDOWS = 12; // ~1 year ahead

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

async function sq(token: string, url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 429 || attempt >= 4) return res;
    await res.text().catch(() => "");
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}

function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

async function searchCustomers(token: string, filter: Record<string, unknown>): Promise<string[] | null> {
  const res = await sq(token, `${SQUARE_BASE}/v2/customers/search`, {
    method: "POST",
    body: JSON.stringify({ limit: 10, query: { filter } }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { customers?: { id: string }[] };
  return (j.customers ?? []).map((c) => c.id);
}

/**
 * Resolve Square customer IDs for a client: stored mapping first, then exact
 * phone / email lookups. Returns null when lookup itself failed.
 */
export async function resolveSquareCustomerIds(
  token: string,
  c: { square_customer_id: string | null; phone: string | null; email: string | null },
): Promise<string[] | null> {
  const ids = new Set<string>();
  if (c.square_customer_id) ids.add(c.square_customer_id);
  const phone = e164(c.phone);
  if (phone) {
    const r = await searchCustomers(token, { phone_number: { exact: phone } });
    if (r === null) return null;
    r.forEach((i) => ids.add(i));
  }
  const email = c.email?.trim();
  if (email) {
    const r = await searchCustomers(token, { email_address: { exact: email } });
    if (r === null) return null;
    r.forEach((i) => ids.add(i));
  }
  return [...ids];
}

/** Live upcoming bookings for a Square customer. Returns null on any failure. */
export async function fetchUpcomingBookings(token: string, customerId: string, now: Date): Promise<ArchiveBooking[] | null> {
  const out: ArchiveBooking[] = [];
  for (let w = 0; w < WINDOWS; w++) {
    const start = new Date(now.getTime() + w * WINDOW_DAYS * 86400_000);
    const end = new Date(start.getTime() + WINDOW_DAYS * 86400_000);
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const url = new URL(`${SQUARE_BASE}/v2/bookings`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("customer_id", customerId);
      url.searchParams.set("start_at_min", start.toISOString());
      url.searchParams.set("start_at_max", end.toISOString());
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await sq(token, url.toString());
      if (!res.ok) return null;
      const j = (await res.json()) as { bookings?: ArchiveBooking[]; cursor?: string };
      out.push(...(j.bookings ?? []));
      cursor = j.cursor;
      if (!cursor) break;
    }
  }
  return out;
}

export async function loadLiveSchedule(c: {
  square_customer_id: string | null;
  phone: string | null;
  email: string | null;
}, now: Date): Promise<{ verified: boolean; bookings: ArchiveBooking[] }> {
  const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
  if (!token) return { verified: false, bookings: [] };
  try {
    const ids = await resolveSquareCustomerIds(token, c);
    if (!ids || ids.length === 0) return { verified: false, bookings: [] };
    const all: ArchiveBooking[] = [];
    for (const id of ids) {
      const b = await fetchUpcomingBookings(token, id, now);
      if (b === null) return { verified: false, bookings: [] };
      all.push(...b);
    }
    return { verified: true, bookings: all };
  } catch {
    return { verified: false, bookings: [] };
  }
}
