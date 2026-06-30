import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

type SquareCustomer = {
  id: string;
  given_name?: string | null;
  family_name?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  company_name?: string | null;
  nickname?: string | null;
};

type SquareBooking = {
  id: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
};

export type BackfillResult = {
  fetched_customers: number;
  fetched_bookings: number;
  created: number;
  updated_contact: number;
  skipped_active_package: number;
  skipped_deleted: number;
  skipped_no_name: number;
  errors: string[];
  status_assignments: { active: number; assessment: number; archived: number };
};

function cleanToken(t: string | undefined | null): string {
  return (t ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

async function squareGet<T>(token: string, url: string): Promise<{ ok: boolean; json?: T; error?: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Square ${res.status}: ${body.slice(0, 300)}` };
  }
  return { ok: true, json: (await res.json()) as T };
}

async function fetchAllCustomers(token: string): Promise<{ customers: SquareCustomer[]; error: string | null }> {
  const all: SquareCustomer[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const url = new URL(`${SQUARE_BASE}/v2/customers`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sort_field", "CREATED_AT");
    url.searchParams.set("sort_order", "DESC");
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await squareGet<{ customers?: SquareCustomer[]; cursor?: string }>(token, url.toString());
    if (!r.ok) return { customers: all, error: r.error ?? "Square error" };
    if (r.json?.customers?.length) all.push(...r.json.customers);
    cursor = r.json?.cursor;
    if (!cursor) break;
  }
  return { customers: all, error: null };
}

async function fetchFutureBookings(token: string): Promise<Set<string>> {
  const out = new Set<string>();
  const now = new Date();
  // 30-day forward window (under Square's 31-day limit)
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${SQUARE_BASE}/v2/bookings`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("start_at_min", now.toISOString());
    url.searchParams.set("start_at_max", end.toISOString());
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await squareGet<{ bookings?: SquareBooking[]; cursor?: string }>(token, url.toString());
    if (!r.ok) break;
    for (const b of r.json?.bookings ?? []) {
      if (!b.customer_id) continue;
      if (b.status && /(CANCELLED|DECLINED|NO_SHOW)/i.test(b.status)) continue;
      out.add(b.customer_id);
    }
    cursor = r.json?.cursor;
    if (!cursor) break;
  }
  return out;
}

export const backfillProductionCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackfillResult> => {
    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    const result: BackfillResult = {
      fetched_customers: 0,
      fetched_bookings: 0,
      created: 0,
      updated_contact: 0,
      skipped_active_package: 0,
      skipped_deleted: 0,
      skipped_no_name: 0,
      errors: [],
      status_assignments: { active: 0, assessment: 0, archived: 0 },
    };
    if (!token) {
      result.errors.push("SQUARE_PRODUCTION_ACCESS_TOKEN not configured");
      return result;
    }

    const [{ customers, error: cErr }, futureCustomerIds] = await Promise.all([
      fetchAllCustomers(token),
      fetchFutureBookings(token),
    ]);
    if (cErr) result.errors.push(cErr);
    result.fetched_customers = customers.length;
    result.fetched_bookings = futureCustomerIds.size;

    // Load existing clients (include soft-deleted)
    const { data: existing, error: eErr } = await context.supabase
      .from("clients")
      .select("id, square_customer_id, package_total_visits, visits_used, deleted_at, status");
    if (eErr) throw eErr;

    const bySquareId = new Map<string, NonNullable<typeof existing>[number]>();
    for (const c of existing ?? []) {
      if (c.square_customer_id) bySquareId.set(c.square_customer_id, c);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    for (const cust of customers) {
      try {
        const existing = bySquareId.get(cust.id);
        const hasFuture = futureCustomerIds.has(cust.id);

        if (existing) {
          if (existing.deleted_at) {
            result.skipped_deleted++;
            continue;
          }
          const visitsLeft =
            existing.visits_used === null
              ? existing.package_total_visits
              : Math.max(0, (existing.package_total_visits ?? 0) - (existing.visits_used ?? 0));
          const hasActivePackage = visitsLeft > 0;

          // Update contact info only; never overwrite active package data
          const update: Record<string, unknown> = {};
          if (cust.email_address) update.email = cust.email_address;
          if (cust.phone_number) update.phone = cust.phone_number;
          if (Object.keys(update).length > 0) {
            const { error: uErr } = await supabaseAdmin
              .from("clients")
              .update(update)
              .eq("id", existing.id);
            if (uErr) throw uErr;
            result.updated_contact++;
          }
          if (hasActivePackage) result.skipped_active_package++;
          continue;
        }

        // Not found — create new (match strictly by square_customer_id, never by name)
        const first = (cust.given_name ?? cust.nickname ?? "").trim();
        const last = (cust.family_name ?? cust.company_name ?? "").trim();
        if (!first && !last) {
          result.skipped_no_name++;
          continue;
        }

        const status: "active" | "assessment" | "archived" = hasFuture ? "assessment" : "archived";
        const { error: iErr } = await supabaseAdmin.from("clients").insert({
          first_name: first || "(Unknown)",
          last_name: last || "(Unknown)",
          email: cust.email_address ?? null,
          phone: cust.phone_number ?? null,
          square_customer_id: cust.id,
          status,
          is_scheduled: hasFuture,
          package_total_visits: 0,
          package_price: 0,
          amount_paid: 0,
          internal_notes: "Imported from Square Production",
        });
        if (iErr) throw iErr;
        result.created++;
        result.status_assignments[status]++;
      } catch (e) {
        result.errors.push(`${cust.id}: ${(e as Error).message}`);
      }
    }

    try {
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: "customer.backfill",
        status: result.errors.length ? "partial" : "success",
        action: "production_backfill",
        message: `Backfill: fetched=${result.fetched_customers} created=${result.created} updated=${result.updated_contact} skipped_active=${result.skipped_active_package} skipped_deleted=${result.skipped_deleted} errors=${result.errors.length}`,
      });
    } catch {
      // ignore logging errors
    }

    return result;
  });
