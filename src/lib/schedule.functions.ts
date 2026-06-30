import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Production Square is used ONLY for read-only appointment testing.
// Customer sync and payment sync remain on Sandbox (see square.webhook.ts).
const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

type SquareBookingSegment = {
  duration_minutes?: number | null;
  service_variation_id?: string | null;
  team_member_id?: string | null;
};

type SquareBooking = {
  id: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
  appointment_segments?: SquareBookingSegment[] | null;
};

export type ScheduleClientLite = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  package_total_visits: number;
  visits_used: number | null;
  package_price: number;
  amount_paid: number;
  internal_notes: string | null;
  square_customer_id: string | null;
};

export type ScheduleAppointment = {
  booking_id: string;
  start_at: string;
  status: string;
  duration_minutes: number | null;
  service_name: string | null;
  square_customer_id: string | null;
  client: ScheduleClientLite | null;
};

export type NeedsScheduleClient = ScheduleClientLite & {
  last_appointment_at: string | null;
};

export type ScheduleCheckResult = {
  selected_date: string; // YYYY-MM-DD
  week_start: string;
  week_end: string;
  next_week_start: string;
  next_week_end: string;
  selected_day: ScheduleAppointment[];
  this_week: ScheduleAppointment[];
  next_week: ScheduleAppointment[];
  unmatched: ScheduleAppointment[];
  needs_next_week_scheduling: NeedsScheduleClient[];
  not_scheduled_after: NeedsScheduleClient[];
  fetched_count: number;
  error: string | null;
};

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdUTC(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// Sunday-start week
function weekRange(d: Date): { start: Date; end: Date } {
  const dow = d.getUTCDay(); // 0=Sun
  const start = addDays(d, -dow);
  const end = addDays(start, 6);
  return { start, end };
}

async function fetchSquareBookings(
  token: string,
  startIso: string,
  endIso: string,
): Promise<{ bookings: SquareBooking[]; error: string | null }> {
  const all: SquareBooking[] = [];
  let cursor: string | undefined;
  // Sanitize token: trim, strip wrapping straight/curly quotes, and remove any non-ASCII chars
  // (smart quotes pasted into the secret cause "ByteString" errors when used in a header).
  const rawToken = token ?? "";
  const cleanToken = rawToken
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
  if (cleanToken !== rawToken.trim()) {
    console.warn(
      `[schedule] SQUARE_PRODUCTION_ACCESS_TOKEN was sanitized (orig len ${rawToken.length}, clean len ${cleanToken.length}) — check the secret for smart quotes or stray characters.`,
    );
  }
  if (!cleanToken) {
    return { bookings: all, error: "SQUARE_PRODUCTION_ACCESS_TOKEN is empty after sanitization" };
  }
  console.log(
    `[schedule] Square request → env=PRODUCTION base=${SQUARE_BASE} ` +
      `token_len=${cleanToken.length} token_first4=${cleanToken.slice(0, 4)} ` +
      `token_last4=${cleanToken.slice(-4)} ` +
      `secret_name=SQUARE_PRODUCTION_ACCESS_TOKEN`,
  );
  try {
    for (let i = 0; i < 10; i++) {
      const url = new URL(`${SQUARE_BASE}/v2/bookings`);
      url.searchParams.set("limit", "200");
      url.searchParams.set("start_at_min", startIso);
      url.searchParams.set("start_at_max", endIso);
      if (cursor) url.searchParams.set("cursor", cursor);
      console.log(`[schedule] GET ${url.toString()}`);
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
      });
      console.log(`[schedule] Square responded ${res.status} ${res.statusText}`);
      if (!res.ok) {
        const body = await res.text();
        let friendly = `Square ${res.status}: ${body.slice(0, 300)}`;
        try {
          const parsed = JSON.parse(body) as {
            errors?: Array<{ code?: string; detail?: string; category?: string }>;
          };
          const first = parsed.errors?.[0];
          const detail = first?.detail ?? "";
          const code = first?.code ?? "";
          if (
            code === "FORBIDDEN" ||
            code === "INSUFFICIENT_SCOPES" ||
            code === "AUTHENTICATION_ERROR" ||
            /Appointments|Bookings/i.test(detail)
          ) {
            friendly =
              "Square Bookings API is not authorized for this access token. " +
              "In the Square Developer Dashboard → your app → OAuth, enable " +
              "APPOINTMENTS_READ (and APPOINTMENTS_BUSINESS_SETTINGS_READ if needed). " +
              "Then in the Sandbox Test Account, make sure the Appointments app is " +
              "installed/enabled for that seller, regenerate the Sandbox access token, " +
              `and update SQUARE_PRODUCTION_ACCESS_TOKEN. Original: ${code} — ${detail}`;
          } else if (first) {
            friendly = `Square ${res.status} ${code}: ${detail || body.slice(0, 200)}`;
          }
        } catch {
          // keep original friendly
        }
        return { bookings: all, error: friendly };
      }
      const json = (await res.json()) as { bookings?: SquareBooking[]; cursor?: string };
      if (json.bookings?.length) all.push(...json.bookings);
      cursor = json.cursor;
      if (!cursor) break;
    }
    return { bookings: all, error: null };
  } catch (e) {
    return { bookings: all, error: (e as Error).message };
  }
}

async function fetchServiceNames(
  token: string,
  variationIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (variationIds.length === 0) return out;
  // eslint-disable-next-line no-control-regex
  const cleanToken = (token ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleanToken) return out;
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/catalog/batch-retrieve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ object_ids: variationIds }),
    });
    if (!res.ok) return out;
    const json = (await res.json()) as {
      objects?: Array<{ id: string; item_variation_data?: { name?: string | null } | null }>;
    };
    for (const obj of json.objects ?? []) {
      const name = obj.item_variation_data?.name;
      if (name) out.set(obj.id, name);
    }
  } catch {
    // ignore — service names are optional
  }
  return out;
}

export const getScheduleCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string }) => {
    if (!d || typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      throw new Error("Invalid date");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<ScheduleCheckResult> => {
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    const selected = parseYmdUTC(data.date);
    const { start: weekStart, end: weekEnd } = weekRange(selected);
    const nextWeekStart = addDays(weekEnd, 1);
    const nextWeekEnd = addDays(nextWeekStart, 6);

    // Fetch window: beginning of selected week through end of next week (max ~14 days, well under Square's 31-day limit)
    const fetchStart = weekStart;
    const fetchEnd = nextWeekEnd;
    const startIso = fetchStart.toISOString();
    const endIso = fetchEnd.toISOString();

    const empty: ScheduleCheckResult = {
      selected_date: data.date,
      week_start: ymd(weekStart),
      week_end: ymd(weekEnd),
      next_week_start: ymd(nextWeekStart),
      next_week_end: ymd(nextWeekEnd),
      selected_day: [],
      this_week: [],
      next_week: [],
      unmatched: [],
      needs_next_week_scheduling: [],
      not_scheduled_after: [],
      fetched_count: 0,
      error: null,
    };

    if (!token) {
      empty.error = "SQUARE_PRODUCTION_ACCESS_TOKEN is not configured";
      return empty;
    }

    const { bookings, error } = await fetchSquareBookings(token, startIso, endIso);

    // Load clients
    const { data: clients, error: cErr } = await context.supabase
      .from("clients")
      .select(
        "id, first_name, last_name, phone, package_total_visits, visits_used, package_price, amount_paid, internal_notes, square_customer_id",
      )
      .is("deleted_at", null);
    if (cErr) throw cErr;

    const byCustomerId = new Map<string, ScheduleClientLite>();
    for (const c of (clients ?? []) as ScheduleClientLite[]) {
      if (c.square_customer_id) byCustomerId.set(c.square_customer_id, c);
    }

    // Resolve service names (best-effort)
    const variationIds = Array.from(
      new Set(
        bookings
          .flatMap((b) => b.appointment_segments ?? [])
          .map((s) => s.service_variation_id ?? "")
          .filter(Boolean),
      ),
    );
    const serviceNames = await fetchServiceNames(token, variationIds);

    // Sort bookings chronologically
    const sorted = [...bookings]
      .filter((b) => b.start_at)
      .sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));

    const all: ScheduleAppointment[] = sorted.map((b) => {
      const seg = b.appointment_segments?.[0];
      const svc = seg?.service_variation_id ? serviceNames.get(seg.service_variation_id) : null;
      const client = b.customer_id ? byCustomerId.get(b.customer_id) ?? null : null;
      return {
        booking_id: b.id,
        start_at: b.start_at as string,
        status: (b.status ?? "UNKNOWN").toString(),
        duration_minutes: seg?.duration_minutes ?? null,
        service_name: svc ?? null,
        square_customer_id: b.customer_id ?? null,
        client,
      };
    });

    // Only show appointments that aren't cancelled/no-show by default? Keep all but mark via status.
    const active = all.filter((a) => !/(CANCELLED|DECLINED|NO_SHOW)/i.test(a.status));

    const selectedYmd = data.date;
    const weekStartYmd = ymd(weekStart);
    const weekEndYmd = ymd(weekEnd);
    const nextWeekStartYmd = ymd(nextWeekStart);
    const nextWeekEndYmd = ymd(nextWeekEnd);

    const dayOf = (iso: string) => iso.slice(0, 10);
    const inRange = (iso: string, a: string, b: string) => {
      const d = dayOf(iso);
      return d >= a && d <= b;
    };

    const selected_day = active.filter((a) => dayOf(a.start_at) === selectedYmd);
    const this_week = active.filter((a) => inRange(a.start_at, weekStartYmd, weekEndYmd));
    const next_week = active.filter((a) =>
      inRange(a.start_at, nextWeekStartYmd, nextWeekEndYmd),
    );
    const unmatched = active.filter((a) => !a.client);

    // Clients with appointments this week (matched) and not next week
    const thisWeekClientIds = new Set(
      this_week.filter((a) => a.client).map((a) => a.client!.id),
    );
    const nextWeekClientIds = new Set(
      next_week.filter((a) => a.client).map((a) => a.client!.id),
    );

    const visitsLeft = (c: ScheduleClientLite) =>
      c.visits_used === null || c.visits_used === undefined
        ? c.package_total_visits > 0
          ? c.package_total_visits
          : 0
        : Math.max(0, (c.package_total_visits ?? 0) - c.visits_used);

    const clientList = (clients ?? []) as ScheduleClientLite[];

    // last appointment date per client across active bookings
    const lastApptByClient = new Map<string, string>();
    for (const a of active) {
      if (!a.client) continue;
      const prev = lastApptByClient.get(a.client.id);
      if (!prev || a.start_at > prev) lastApptByClient.set(a.client.id, a.start_at);
    }
    // any appointment strictly after selected date
    const hasApptAfter = new Map<string, boolean>();
    for (const a of active) {
      if (!a.client) continue;
      if (dayOf(a.start_at) > selectedYmd) hasApptAfter.set(a.client.id, true);
    }

    const needs_next_week_scheduling: NeedsScheduleClient[] = clientList
      .filter(
        (c) =>
          visitsLeft(c) > 0 &&
          thisWeekClientIds.has(c.id) &&
          !nextWeekClientIds.has(c.id),
      )
      .map((c) => ({ ...c, last_appointment_at: lastApptByClient.get(c.id) ?? null }));

    const not_scheduled_after: NeedsScheduleClient[] = clientList
      .filter((c) => visitsLeft(c) > 0 && !hasApptAfter.get(c.id))
      .map((c) => ({ ...c, last_appointment_at: lastApptByClient.get(c.id) ?? null }));

    // Log the check (best-effort, never throws)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: "schedule.check",
        status: error ? "error" : "success",
        action: "schedule_check",
        message: error
          ? `Schedule check ${data.date} failed: ${error}`
          : `Schedule check ${data.date}: ${bookings.length} bookings, ${unmatched.length} unmatched`,
      });
    } catch {
      // ignore logging errors
    }

    return {
      selected_date: data.date,
      week_start: weekStartYmd,
      week_end: weekEndYmd,
      next_week_start: nextWeekStartYmd,
      next_week_end: nextWeekEndYmd,
      selected_day,
      this_week,
      next_week,
      unmatched,
      needs_next_week_scheduling,
      not_scheduled_after,
      fetched_count: bookings.length,
      error,
    };
  });

export const completeVisitForClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: c, error } = await context.supabase
      .from("clients")
      .select("visits_used, package_total_visits")
      .eq("id", data.clientId)
      .single();
    if (error) throw error;
    const current = c?.visits_used ?? 0;
    if (c && current >= c.package_total_visits) {
      throw new Error("All visits already used");
    }
    const next = current + 1;
    const { error: uErr } = await context.supabase
      .from("clients")
      .update({ visits_used: next })
      .eq("id", data.clientId);
    if (uErr) throw uErr;
    await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "visit",
      description: `Visit completed (${next}/${c?.package_total_visits ?? "?"}) — from Schedule Check`,
    });
    return { ok: true, visits_used: next };
  });
