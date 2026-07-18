import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Read-only Square Production integration. Webhooks (customer/payment/booking)
// are also handled against Production — see src/routes/api/public/square.webhook.ts.
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
  status: string | null;
  manual_active: boolean | null;
};

export type ProductionCustomerInfo = {
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone: string | null;
};

export type ScheduleAppointment = {
  booking_id: string;
  start_at: string;
  status: string;
  duration_minutes: number | null;
  service_name: string | null;
  team_member_name: string | null;
  square_customer_id: string | null;
  customer_info: ProductionCustomerInfo | null;
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

// Clinic operates in Tullahoma, TN. All week/day bucketing is done in this
// local timezone so late-evening appointments don't roll into the next UTC day.
const CLINIC_TZ = "America/Chicago";

// Format an instant as YYYY-MM-DD in the clinic's local timezone.
function ymdInTz(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Offset (minutes) of the clinic tz relative to UTC at the given instant.
// Negative for America/Chicago (CST = -360, CDT = -300).
function tzOffsetMinutes(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) if (p.type !== "literal") map[p.type] = p.value;
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return (asUTC - d.getTime()) / 60000;
}

// Convert a clinic-local YYYY-MM-DD (calendar date) to the UTC instant of
// midnight at the start of that day in the clinic timezone.
function ymdLocalToInstant(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Compute the tz offset for that moment and shift so the resulting instant
  // renders as 00:00 in the clinic tz.
  const off = tzOffsetMinutes(new Date(utcMidnight));
  return new Date(utcMidnight - off * 60000);
}

// Weekday (0=Sun..6=Sat) for a calendar date string. Purely calendar math —
// no timezone needed since the date is already specified in local terms.
function ymdWeekday(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Business week is Monday–Friday (5 days). Saturday and Sunday roll FORWARD
// into the upcoming work week: on Sat/Sun, `workWeekStartFromYmd` returns
// the next Monday, so weekend appointments/payments count toward next week.
// On Mon–Fri, it returns the Monday of the current work week.
function workWeekStartFromYmd(ymd: string): string {
  const dow = ymdWeekday(ymd); // 0=Sun..6=Sat
  const offset = dow === 0 ? 1 : dow === 6 ? 2 : -(dow - 1);
  return addDaysYmd(ymd, offset);
}
const WORK_WEEK_DAYS = 4; // Mon + 4 = Fri


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
  try {
    for (let i = 0; i < 10; i++) {
      const url = new URL(`${SQUARE_BASE}/v2/bookings`);
      url.searchParams.set("limit", "200");
      url.searchParams.set("start_at_min", startIso);
      url.searchParams.set("start_at_max", endIso);
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
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
              "APPOINTMENTS_READ (and APPOINTMENTS_BUSINESS_SETTINGS_READ if needed), " +
              `regenerate the Production access token, and update SQUARE_PRODUCTION_ACCESS_TOKEN. Original: ${code} — ${detail}`;
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
      signal: AbortSignal.timeout(5000),
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

async function fetchTeamMemberNames(
  token: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  // eslint-disable-next-line no-control-regex
  const cleanToken = (token ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleanToken) return out;
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/team-members/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: { filter: { team_member_ids: ids } },
        limit: 200,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return out;
    const json = (await res.json()) as {
      team_members?: Array<{
        id?: string;
        given_name?: string | null;
        family_name?: string | null;
      }>;
    };
    for (const t of json.team_members ?? []) {
      if (!t.id) continue;
      const name = [t.given_name, t.family_name].filter(Boolean).join(" ").trim()
        || t.given_name || t.family_name || null;
      if (name) out.set(t.id, name);
    }
  } catch {
    // ignore — provider names are optional
  }
  return out;
}

async function fetchProductionCustomers(
  token: string,
  customerIds: string[],
): Promise<Map<string, ProductionCustomerInfo>> {
  const out = new Map<string, ProductionCustomerInfo>();
  if (customerIds.length === 0) return out;
  // eslint-disable-next-line no-control-regex
  const cleanToken = (token ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleanToken) return out;
  // Hydrate ALL requested customer IDs (no silent 50-item cap). Chunk to avoid
  // exhausting sockets on large unmatched sets.
  const CHUNK = 25;
  const HARD_CAP = 500;
  const ids = customerIds.slice(0, HARD_CAP);
  if (customerIds.length > HARD_CAP) {
    console.warn(
      `[schedule] fetchProductionCustomers: ${customerIds.length} IDs exceeded hard cap ${HARD_CAP}; truncating.`,
    );
  }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await fetch(`${SQUARE_BASE}/v2/customers/${encodeURIComponent(id)}`, {
            headers: {
              Authorization: `Bearer ${cleanToken}`,
              "Square-Version": SQUARE_VERSION,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return;
          const json = (await res.json()) as {
            customer?: {
              given_name?: string | null;
              family_name?: string | null;
              email_address?: string | null;
              phone_number?: string | null;
            };
          };
          const c = json.customer;
          if (!c) return;
          out.set(id, {
            given_name: c.given_name ?? null,
            family_name: c.family_name ?? null,
            email: c.email_address ?? null,
            phone: c.phone_number ?? null,
          });
        } catch {
          // ignore per-customer failures
        }
      }),
    );
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
    const selectedYmd = data.date;
    // Business week runs Monday–Friday. Weekends roll into the upcoming
    // work week, so bucketing uses `workWeekStartFromYmd` on each date.
    const weekStartYmd = workWeekStartFromYmd(selectedYmd);
    const weekEndYmd = addDaysYmd(weekStartYmd, WORK_WEEK_DAYS);
    const nextWeekStartYmd = addDaysYmd(weekStartYmd, 7);
    const nextWeekEndYmd = addDaysYmd(nextWeekStartYmd, WORK_WEEK_DAYS);

    // Fetch window: extend 2 days before this week's Monday (to include the
    // preceding Sat/Sun that roll INTO this week) through the last instant
    // of the Sun after next week's Friday (to include Sat/Sun that roll
    // into a following week we don't bucket — harmless, just extra data).
    const fetchStart = ymdLocalToInstant(addDaysYmd(weekStartYmd, -2));
    const fetchEnd = new Date(ymdLocalToInstant(addDaysYmd(nextWeekEndYmd, 3)).getTime() - 1);
    const startIso = fetchStart.toISOString();
    const endIso = fetchEnd.toISOString();

    const empty: ScheduleCheckResult = {
      selected_date: data.date,
      week_start: weekStartYmd,
      week_end: weekEndYmd,
      next_week_start: nextWeekStartYmd,
      next_week_end: nextWeekEndYmd,
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

    // Load clients — paginated in 1000-row chunks so clients past the default
    // PostgREST 1000-row cap are still included in the matching map.
    const clients: ScheduleClientLite[] = [];
    {
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data: page, error: cErr } = await context.supabase
          .from("clients")
          .select(
            "id, first_name, last_name, phone, package_total_visits, visits_used, package_price, amount_paid, internal_notes, square_customer_id, status, manual_active",
          )
          .is("deleted_at", null)
          .range(from, from + pageSize - 1);
        if (cErr) throw cErr;
        if (!page || page.length === 0) break;
        clients.push(...(page as ScheduleClientLite[]));
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }
    console.info(
      `[schedule] Loaded ${clients.length} non-deleted clients (` +
        `${clients.filter((c) => c.square_customer_id).length} with square_customer_id)`,
    );

    // Match bookings to clients by Square customer ID.
    const byCustomerId = new Map<string, ScheduleClientLite>();
    for (const c of (clients ?? []) as ScheduleClientLite[]) {
      if (c.square_customer_id) byCustomerId.set(c.square_customer_id, c);
    }
    const matchClient = (customerId: string | null | undefined): ScheduleClientLite | null => {
      if (!customerId) return null;
      return byCustomerId.get(customerId) ?? null;
    };

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

    // Resolve team-member (provider/therapist) names (best-effort)
    const teamMemberIds = Array.from(
      new Set(
        sorted
          .flatMap((b) => b.appointment_segments ?? [])
          .map((s) => s.team_member_id ?? "")
          .filter(Boolean),
      ),
    );
    const teamMemberNames = await fetchTeamMemberNames(token, teamMemberIds);

    // Fetch production customer info for unmatched booking customer IDs (best effort, to help linking)
    const unmatchedCustomerIds = Array.from(
      new Set(
        sorted
          .map((b) => b.customer_id ?? "")
          .filter((id) => id && !matchClient(id)),
      ),
    );
    const customerInfoMap = await fetchProductionCustomers(token, unmatchedCustomerIds);

    const all: ScheduleAppointment[] = sorted.map((b) => {
      const seg = b.appointment_segments?.[0];
      const svc = seg?.service_variation_id ? serviceNames.get(seg.service_variation_id) : null;
      const tmName = seg?.team_member_id ? teamMemberNames.get(seg.team_member_id) ?? null : null;
      const client = matchClient(b.customer_id);
      return {
        booking_id: b.id,
        start_at: b.start_at as string,
        status: (b.status ?? "UNKNOWN").toString(),
        duration_minutes: seg?.duration_minutes ?? null,
        service_name: svc ?? null,
        team_member_name: tmName,
        square_customer_id: b.customer_id ?? null,
        customer_info: b.customer_id ? customerInfoMap.get(b.customer_id) ?? null : null,
        client,
      };
    });

    // Only show appointments that aren't cancelled/no-show by default? Keep all but mark via status.
    const active = all.filter((a) => !/(CANCELLED|DECLINED|NO_SHOW)/i.test(a.status));

    // Bucket by the work-week (Mon–Fri) each appointment BELONGS to. Sat/Sun
    // appointments roll forward into the upcoming work week per business rule.
    const dayOf = (iso: string) => ymdInTz(new Date(iso));
    const bucketOf = (iso: string) => workWeekStartFromYmd(dayOf(iso));

    const selected_day = active.filter((a) => dayOf(a.start_at) === selectedYmd);
    const this_week = active.filter((a) => bucketOf(a.start_at) === weekStartYmd);
    const next_week = active.filter((a) => bucketOf(a.start_at) === nextWeekStartYmd);
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

    // Reports must exclude archived clients — matching map above still
    // contains them so appointments continue to resolve for display, but
    // "Not Scheduled After Selected Date" / "Needs Next Week Scheduling"
    // (and any other clientList-derived report) filter them out here.
    const clientList = ((clients ?? []) as ScheduleClientLite[]).filter(
      (c) => c.status !== "archived",
    );

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

export type LinkableClient = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  square_customer_id: string | null;
  status: string | null;
  package_total_visits: number;
  visits_used: number | null;
  package_price: number;
  amount_paid: number;
};

export const listLinkableClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LinkableClient[]> => {
    // Paginate in 1000-row chunks so the manual link picker sees every client
    // past PostgREST's default 1000-row cap.
    const all: LinkableClient[] = [];
    const pageSize = 1000;
    let from = 0;
    for (let i = 0; i < 100; i++) {
      const { data, error } = await context.supabase
        .from("clients")
        .select(
          "id, first_name, last_name, phone, email, square_customer_id, status, package_total_visits, visits_used, package_price, amount_paid",
        )
        .is("deleted_at", null)
        .order("first_name", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as LinkableClient[];
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });

export const linkSquareCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; squareCustomerId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    if (!d?.squareCustomerId) throw new Error("squareCustomerId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    // Prevent linking the same Square customer ID to two different clients
    const { data: existing, error: eErr } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name")
      .eq("square_customer_id", data.squareCustomerId)
      .is("deleted_at", null)
      .neq("id", data.clientId)
      .maybeSingle();
    if (eErr) throw eErr;
    if (existing) {
      throw new Error(
        `Square customer is already linked to ${existing.first_name} ${existing.last_name}. Unlink them first.`,
      );
    }

    const { error } = await context.supabase
      .from("clients")
      .update({ square_customer_id: data.squareCustomerId })
      .eq("id", data.clientId);
    if (error) throw error;

    await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "square_link",
      description: `Linked Square customer ${data.squareCustomerId}`,
      metadata: { square_customer_id: data.squareCustomerId },
    });
    return { ok: true };
  });

export const unlinkSquareCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update({ square_customer_id: null })
      .eq("id", data.clientId);
    if (error) throw error;
    await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "square_unlink",
      description: "Unlinked Square customer",
    });
    return { ok: true };
  });

/**
 * Single source of truth for "is this client scheduled?".
 *
 * A client is scheduled iff at least one ACTIVE Square booking exists for their
 * linked square_customer_id within the lookahead window (today → +days). The
 * scheduling status is derived live from Square bookings only.
 */
export const getScheduledClientIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number } | undefined) => ({
    days: Math.min(60, Math.max(1, Number(d?.days ?? 30))),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ client_ids: string[]; fetched_count: number; error: string | null }> => {
      const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
      if (!token) {
        return {
          client_ids: [],
          fetched_count: 0,
          error: "SQUARE_PRODUCTION_ACCESS_TOKEN is not configured",
        };
      }
      const now = new Date();
      const end = new Date(now.getTime() + data.days * 24 * 60 * 60 * 1000);
      const { bookings, error } = await fetchSquareBookings(
        token,
        now.toISOString(),
        end.toISOString(),
      );
      if (error) {
        return { client_ids: [], fetched_count: bookings.length, error };
      }

      const customerIds = new Set<string>();
      for (const b of bookings) {
        const status = (b.status ?? "").toString().toUpperCase();
        if (/CANCEL|DECLINE|NO_SHOW/.test(status)) continue;
        if (b.customer_id) customerIds.add(b.customer_id);
      }
      if (customerIds.size === 0) {
        return { client_ids: [], fetched_count: bookings.length, error: null };
      }

      const { data: rows, error: cErr } = await context.supabase
        .from("clients")
        .select("id, square_customer_id")
        .is("deleted_at", null)
        .in("square_customer_id", Array.from(customerIds));
      if (cErr) throw cErr;

      const ids = (rows ?? [])
        .map((r) => (r as { id: string }).id)
        .filter(Boolean);
      return { client_ids: ids, fetched_count: bookings.length, error: null };
    },
  );

/**
 * Client IDs scheduled for an ACTIVE Square booking in the current
 * clinic-local WORK week (Monday–Friday, America/Chicago). Sat/Sun bookings
 * roll into the upcoming work week. Reuses the same week-boundary logic as
 * the Schedule Check page.
 */
export const getThisWeekScheduledClientIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ client_ids: string[]; week_start: string; week_end: string; error: string | null }> => {
      const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
      const todayYmd = ymdInTz(new Date());
      const weekStartYmd = workWeekStartFromYmd(todayYmd);
      const weekEndYmd = addDaysYmd(weekStartYmd, WORK_WEEK_DAYS);
      if (!token) {
        return {
          client_ids: [],
          week_start: weekStartYmd,
          week_end: weekEndYmd,
          error: "SQUARE_PRODUCTION_ACCESS_TOKEN is not configured",
        };
      }
      // Widen fetch by ±2 days so weekend bookings that roll INTO this
      // work-week bucket are still returned by Square.
      const fetchStart = ymdLocalToInstant(addDaysYmd(weekStartYmd, -2));
      const fetchEnd = new Date(
        ymdLocalToInstant(addDaysYmd(weekEndYmd, 3)).getTime() - 1,
      );
      const { bookings, error } = await fetchSquareBookings(
        token,
        fetchStart.toISOString(),
        fetchEnd.toISOString(),
      );
      if (error) {
        return { client_ids: [], week_start: weekStartYmd, week_end: weekEndYmd, error };
      }

      const customerIds = new Set<string>();
      for (const b of bookings) {
        const status = (b.status ?? "").toString().toUpperCase();
        if (/CANCEL|DECLINE|NO_SHOW/.test(status)) continue;
        if (!b.start_at) continue;
        // Only count bookings whose work-week bucket == this week.
        const day = ymdInTz(new Date(b.start_at));
        if (workWeekStartFromYmd(day) !== weekStartYmd) continue;
        if (b.customer_id) customerIds.add(b.customer_id);
      }
      if (customerIds.size === 0) {
        return { client_ids: [], week_start: weekStartYmd, week_end: weekEndYmd, error: null };
      }

      const { data: rows, error: cErr } = await context.supabase
        .from("clients")
        .select("id, square_customer_id")
        .is("deleted_at", null)
        .in("square_customer_id", Array.from(customerIds));
      if (cErr) throw cErr;

      const ids = (rows ?? [])
        .map((r) => (r as { id: string }).id)
        .filter(Boolean);
      return { client_ids: ids, week_start: weekStartYmd, week_end: weekEndYmd, error: null };
    },
  );

/**
 * Client IDs scheduled for an ACTIVE Square booking in NEXT WORK week
 * (Monday–Friday, America/Chicago). Sat/Sun bookings roll INTO the upcoming
 * work week's bucket per business rule.
 */
export const getNextWeekScheduledClientIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ client_ids: string[]; week_start: string; week_end: string; error: string | null }> => {
      const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
      const todayYmd = ymdInTz(new Date());
      const thisWeekStart = workWeekStartFromYmd(todayYmd);
      const weekStartYmd = addDaysYmd(thisWeekStart, 7);
      const weekEndYmd = addDaysYmd(weekStartYmd, WORK_WEEK_DAYS);
      if (!token) {
        return {
          client_ids: [],
          week_start: weekStartYmd,
          week_end: weekEndYmd,
          error: "SQUARE_PRODUCTION_ACCESS_TOKEN is not configured",
        };
      }
      // Widen fetch by ±2 days to catch weekend bookings that roll into this bucket.
      const fetchStart = ymdLocalToInstant(addDaysYmd(weekStartYmd, -2));
      const fetchEnd = new Date(
        ymdLocalToInstant(addDaysYmd(weekEndYmd, 3)).getTime() - 1,
      );
      const { bookings, error } = await fetchSquareBookings(
        token,
        fetchStart.toISOString(),
        fetchEnd.toISOString(),
      );
      if (error) {
        return { client_ids: [], week_start: weekStartYmd, week_end: weekEndYmd, error };
      }

      const customerIds = new Set<string>();
      for (const b of bookings) {
        const status = (b.status ?? "").toString().toUpperCase();
        if (/CANCEL|DECLINE|NO_SHOW/.test(status)) continue;
        if (!b.start_at) continue;
        const day = ymdInTz(new Date(b.start_at));
        if (workWeekStartFromYmd(day) !== weekStartYmd) continue;
        if (b.customer_id) customerIds.add(b.customer_id);
      }
      if (customerIds.size === 0) {
        return { client_ids: [], week_start: weekStartYmd, week_end: weekEndYmd, error: null };
      }

      const { data: rows, error: cErr } = await context.supabase
        .from("clients")
        .select("id, square_customer_id")
        .is("deleted_at", null)
        .in("square_customer_id", Array.from(customerIds));
      if (cErr) throw cErr;

      const ids = (rows ?? [])
        .map((r) => (r as { id: string }).id)
        .filter(Boolean);
      return { client_ids: ids, week_start: weekStartYmd, week_end: weekEndYmd, error: null };
    },
  );

/**
 * Client IDs that had an ACTIVE Square booking in any week PRIOR to the
 * current clinic-local week, within the last `weeks_back` weeks (default 8).
 * Returns each client's most recent prior scheduled instant so the caller
 * can render a "Carried over from <date range>" tag. Excludes any client
 * scheduled in the current week.
 */
export const getPriorWeeksScheduledClientLastDates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { weeks_back?: number } | undefined) => ({
    weeks_back: Math.min(12, Math.max(1, Number(d?.weeks_back ?? 8))),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      clients: Array<{ client_id: string; last_scheduled_at: string }>;
      window_start: string;
      window_end: string;
      error: string | null;
    }> => {
      const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
      const todayYmd = ymdInTz(new Date());
      const dow = ymdWeekday(todayYmd);
      const mondayOffset = (dow + 6) % 7;
      const thisWeekStartYmd = addDaysYmd(todayYmd, -mondayOffset);
      const priorWindowStartYmd = addDaysYmd(thisWeekStartYmd, -7 * data.weeks_back);

      const emptyResp = {
        clients: [] as Array<{ client_id: string; last_scheduled_at: string }>,
        window_start: priorWindowStartYmd,
        window_end: addDaysYmd(thisWeekStartYmd, -1),
        error: null as string | null,
      };
      if (!token) {
        emptyResp.error = "SQUARE_PRODUCTION_ACCESS_TOKEN is not configured";
        return emptyResp;
      }

      // Square caps a single bookings query at 31 days — page through in
      // 31-day windows from priorWindowStartYmd up to (but not including)
      // this week's start.
      const windowStartInstant = ymdLocalToInstant(priorWindowStartYmd);
      const windowEndInstant = new Date(ymdLocalToInstant(thisWeekStartYmd).getTime() - 1);
      const CHUNK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days to stay comfortably under 31
      const latestByCustomer = new Map<string, string>();
      for (
        let chunkStart = windowStartInstant.getTime();
        chunkStart <= windowEndInstant.getTime();
        chunkStart += CHUNK_MS
      ) {
        const chunkEnd = Math.min(chunkStart + CHUNK_MS - 1, windowEndInstant.getTime());
        const { bookings, error } = await fetchSquareBookings(
          token,
          new Date(chunkStart).toISOString(),
          new Date(chunkEnd).toISOString(),
        );
        if (error) {
          return { ...emptyResp, error };
        }
        for (const b of bookings) {
          const status = (b.status ?? "").toString().toUpperCase();
          if (/CANCEL|DECLINE|NO_SHOW/.test(status)) continue;
          if (!b.start_at || !b.customer_id) continue;
          // Must fall in a PRIOR week (before this week's start, in clinic tz).
          const day = ymdInTz(new Date(b.start_at));
          if (day >= thisWeekStartYmd) continue;
          if (day < priorWindowStartYmd) continue;
          const prev = latestByCustomer.get(b.customer_id);
          if (!prev || b.start_at > prev) latestByCustomer.set(b.customer_id, b.start_at);
        }
      }

      if (latestByCustomer.size === 0) return emptyResp;

      const { data: rows, error: cErr } = await context.supabase
        .from("clients")
        .select("id, square_customer_id")
        .is("deleted_at", null)
        .in("square_customer_id", Array.from(latestByCustomer.keys()));
      if (cErr) throw cErr;

      const clients = (rows ?? [])
        .map((r) => {
          const row = r as { id: string; square_customer_id: string | null };
          const last = row.square_customer_id
            ? latestByCustomer.get(row.square_customer_id)
            : undefined;
          return last ? { client_id: row.id, last_scheduled_at: last } : null;
        })
        .filter((v): v is { client_id: string; last_scheduled_at: string } => v !== null);

      return { ...emptyResp, clients };
    },
  );



export type ClientAppointment = {
  booking_id: string;
  start_at: string;
  status: string;
  duration_minutes: number | null;
  service_name: string | null;
  team_member_name: string | null;
};

export type ClientAppointmentsResult = {
  appointments: ClientAppointment[];
  fetched_count: number;
  error: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 31 * MS_PER_DAY;

/**
 * Fetch Square bookings for a single client within a bounded time window.
 * Square's Bookings API rejects windows longer than 31 days, so callers must
 * paginate by requesting multiple 31-day windows. Read-only; scheduling
 * itself is still managed in Square.
 */
export const getClientAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; startIso: string; endIso: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    const start = new Date(d.startIso);
    const end = new Date(d.endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Invalid time range");
    }
    if (end.getTime() <= start.getTime()) throw new Error("endIso must be after startIso");
    if (end.getTime() - start.getTime() > MAX_WINDOW_MS) {
      throw new Error("Time range exceeds 31 days");
    }
    return { clientId: d.clientId, startIso: start.toISOString(), endIso: end.toISOString() };
  })
  .handler(async ({ data, context }): Promise<ClientAppointmentsResult> => {
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    const empty: ClientAppointmentsResult = {
      appointments: [],
      fetched_count: 0,
      error: null,
    };
    if (!token) {
      console.error("[appointments] SQUARE_PRODUCTION_ACCESS_TOKEN missing");
      empty.error = "unavailable";
      return empty;
    }

    const { data: client, error: cErr } = await context.supabase
      .from("clients")
      .select("square_customer_id")
      .eq("id", data.clientId)
      .single();
    if (cErr) throw cErr;
    const squareCustomerId = (client as { square_customer_id: string | null } | null)
      ?.square_customer_id;
    if (!squareCustomerId) return empty;

    const { bookings, error } = await fetchSquareBookings(token, data.startIso, data.endIso);
    if (error) {
      console.error(
        `[appointments] Square error for client=${data.clientId} window=${data.startIso}..${data.endIso}: ${error}`,
      );
      empty.error = "unavailable";
      empty.fetched_count = bookings.length;
      return empty;
    }

    const mine = bookings.filter((b) => b.customer_id === squareCustomerId && b.start_at);

    const variationIds = Array.from(
      new Set(
        mine
          .flatMap((b) => b.appointment_segments ?? [])
          .map((s) => s.service_variation_id ?? "")
          .filter(Boolean),
      ),
    );
    const teamMemberIds = Array.from(
      new Set(
        mine
          .flatMap((b) => b.appointment_segments ?? [])
          .map((s) => s.team_member_id ?? "")
          .filter(Boolean),
      ),
    );
    const [serviceNames, teamMemberNames] = await Promise.all([
      fetchServiceNames(token, variationIds),
      fetchTeamMemberNames(token, teamMemberIds),
    ]);

    const appointments: ClientAppointment[] = mine
      .map((b) => {
        const seg = b.appointment_segments?.[0];
        return {
          booking_id: b.id,
          start_at: b.start_at as string,
          status: (b.status ?? "UNKNOWN").toString(),
          duration_minutes: seg?.duration_minutes ?? null,
          service_name: seg?.service_variation_id
            ? serviceNames.get(seg.service_variation_id) ?? null
            : null,
          team_member_name: seg?.team_member_id
            ? teamMemberNames.get(seg.team_member_id) ?? null
            : null,
        };
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at));

    return { appointments, fetched_count: bookings.length, error: null };
  });

export const getContactedClientIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientIds: string[] }) => {
    if (!d || !Array.isArray(d.clientIds)) throw new Error("clientIds required");
    return d;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ client_ids: string[]; prior_client_ids: string[]; week_start: string }> => {
      const todayYmd = ymdInTz(new Date());
      const dow = ymdWeekday(todayYmd);
      const mondayOffset = (dow + 6) % 7;
      const weekStartYmd = addDaysYmd(todayYmd, -mondayOffset);
      const weekStartInstant = ymdLocalToInstant(weekStartYmd).toISOString();
      if (data.clientIds.length === 0) {
        return { client_ids: [], prior_client_ids: [], week_start: weekStartYmd };
      }
      const { data: rows, error } = await context.supabase
        .from("client_activities")
        .select("client_id, created_at")
        .eq("activity_type", "contacted")
        .in("client_id", data.clientIds);
      if (error) throw error;
      const current = new Set<string>();
      const prior = new Set<string>();
      for (const r of rows ?? []) {
        if (!r.client_id) continue;
        const id = r.client_id as string;
        const ts = r.created_at as string | null;
        if (ts && ts >= weekStartInstant) current.add(id);
        else prior.add(id);
      }
      // A client that has been contacted this week is "active", not "prior".
      for (const id of current) prior.delete(id);
      return {
        client_ids: Array.from(current),
        prior_client_ids: Array.from(prior),
        week_start: weekStartYmd,
      };
    },
  );

export const markClientContacted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "contacted",
      description: "Marked as contacted — from Schedule Check (This Week But Not Next Week)",
    });
    if (error) throw error;
    return { ok: true };
  });

export const unmarkClientContacted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; deleted: number }> => {
    const todayYmd = ymdInTz(new Date());
    const dow = ymdWeekday(todayYmd);
    const mondayOffset = (dow + 6) % 7;
    const weekStartYmd = addDaysYmd(todayYmd, -mondayOffset);
    const weekStartInstant = ymdLocalToInstant(weekStartYmd).toISOString();
    const { data: rows, error } = await context.supabase
      .from("client_activities")
      .delete()
      .eq("client_id", data.clientId)
      .eq("activity_type", "contacted")
      .gte("created_at", weekStartInstant)
      .select("id");
    if (error) throw error;
    return { ok: true, deleted: rows?.length ?? 0 };
  });


export const getUnavailableNextWeekClientIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientIds: string[] }) => {
    if (!d || !Array.isArray(d.clientIds)) throw new Error("clientIds required");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ client_ids: string[] }> => {
    if (data.clientIds.length === 0) return { client_ids: [] };
    const { data: rows, error } = await context.supabase
      .from("client_activities")
      .select("client_id")
      .eq("activity_type", "unavailable_next_week")
      .in("client_id", data.clientIds);
    if (error) throw error;
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.client_id) set.add(r.client_id as string);
    return { client_ids: Array.from(set) };
  });

export const markClientUnavailableNextWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; reason?: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    const reason = typeof d.reason === "string" ? d.reason.trim().slice(0, 200) : "";
    return { clientId: d.clientId, reason };
  })
  .handler(async ({ data, context }) => {
    const desc = data.reason
      ? `Can't be scheduled next week — ${data.reason}`
      : "Can't be scheduled next week — from Schedule Check";
    const { error } = await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "unavailable_next_week",
      description: desc,
      metadata: data.reason ? { reason: data.reason } : {},
    });
    if (error) throw error;
    return { ok: true };
  });

export const unmarkClientUnavailableNextWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    return { clientId: d.clientId };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; deleted: number }> => {
    const { data: rows, error } = await context.supabase
      .from("client_activities")
      .delete()
      .eq("client_id", data.clientId)
      .eq("activity_type", "unavailable_next_week")
      .select("id");
    if (error) throw error;
    return { ok: true, deleted: rows?.length ?? 0 };
  });


