import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

async function sq(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown; error?: string }> {
  try {
    const res = await fetch(`${SQUARE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, data: parsed, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export type CustomerDiagnostic = {
  customer_id: string;
  profile: {
    given_name: string | null;
    family_name: string | null;
    email_address: string | null;
    phone_number: string | null;
    created_at: string | null;
    updated_at: string | null;
    reference_id: string | null;
    note: string | null;
  } | null;
  profile_error?: string;
  bookings: Array<{
    id: string;
    status: string | null;
    start_at: string | null;
    created_at: string | null;
    location_id: string | null;
  }>;
  bookings_error?: string;
  orders: Array<{
    id: string;
    created_at: string | null;
    state: string | null;
    total_money_cents: number | null;
    location_id: string | null;
    source_name: string | null;
  }>;
  orders_error?: string;
  invoices: Array<{
    id: string;
    status: string | null;
    created_at: string | null;
    title: string | null;
    invoice_number: string | null;
  }>;
  invoices_error?: string;
};

export type SquareDiagnosticResult = {
  location_ids: string[];
  customers: CustomerDiagnostic[];
  overlap: {
    shared_email: boolean;
    shared_phone: boolean;
    same_last_name: boolean;
    same_first_name: boolean;
    shared_order_ids: string[];
    shared_booking_ids: string[];
    shared_invoice_ids: string[];
  } | null;
};

export const runSquareDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customer_ids: string[] }) => d)
  .handler(async ({ data }): Promise<SquareDiagnosticResult> => {
    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    if (!token) throw new Error("SQUARE_PRODUCTION_ACCESS_TOKEN not configured");

    // Fetch locations once
    const locRes = await sq(token, "GET", "/v2/locations");
    const locIds: string[] = Array.isArray(
      (locRes.data as { locations?: Array<{ id: string; status?: string }> })?.locations,
    )
      ? ((locRes.data as { locations: Array<{ id: string; status?: string }> }).locations
          .filter((l) => (l.status ?? "ACTIVE") === "ACTIVE")
          .map((l) => l.id))
      : [];

    const customers: CustomerDiagnostic[] = [];
    for (const cid of data.customer_ids) {
      const diag: CustomerDiagnostic = {
        customer_id: cid,
        profile: null,
        bookings: [],
        orders: [],
        invoices: [],
      };

      // Profile
      const pr = await sq(token, "GET", `/v2/customers/${encodeURIComponent(cid)}`);
      if (pr.error) {
        diag.profile_error = `${pr.error}: ${JSON.stringify(pr.data).slice(0, 300)}`;
      } else {
        const c = (pr.data as { customer?: Record<string, string | null> }).customer ?? null;
        if (c) {
          diag.profile = {
            given_name: (c.given_name as string) ?? null,
            family_name: (c.family_name as string) ?? null,
            email_address: (c.email_address as string) ?? null,
            phone_number: (c.phone_number as string) ?? null,
            created_at: (c.created_at as string) ?? null,
            updated_at: (c.updated_at as string) ?? null,
            reference_id: (c.reference_id as string) ?? null,
            note: (c.note as string) ?? null,
          };
        }
      }

      // Bookings — GET /v2/bookings?customer_id=... (paginate)
      {
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const url = new URL(`${SQUARE_BASE}/v2/bookings`);
          url.searchParams.set("customer_id", cid);
          url.searchParams.set("limit", "200");
          if (cursor) url.searchParams.set("cursor", cursor);
          const res = await fetch(url.toString(), {
            headers: {
              Authorization: `Bearer ${token}`,
              "Square-Version": SQUARE_VERSION,
            },
          });
          const text = await res.text();
          if (!res.ok) {
            diag.bookings_error = `HTTP ${res.status}: ${text.slice(0, 300)}`;
            break;
          }
          const j = JSON.parse(text) as {
            bookings?: Array<{
              id: string;
              status?: string;
              start_at?: string;
              created_at?: string;
              location_id?: string;
            }>;
            cursor?: string;
          };
          for (const b of j.bookings ?? []) {
            diag.bookings.push({
              id: b.id,
              status: b.status ?? null,
              start_at: b.start_at ?? null,
              created_at: b.created_at ?? null,
              location_id: b.location_id ?? null,
            });
          }
          cursor = j.cursor;
          if (!cursor) break;
        }
      }

      // Orders — POST /v2/orders/search filtered by customer_ids
      if (locIds.length > 0) {
        let cursor: string | undefined;
        for (let i = 0; i < 10; i++) {
          const body: Record<string, unknown> = {
            location_ids: locIds,
            query: {
              filter: { customer_filter: { customer_ids: [cid] } },
              sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
            },
            limit: 500,
          };
          if (cursor) body.cursor = cursor;
          const r = await sq(token, "POST", "/v2/orders/search", body);
          if (r.error) {
            diag.orders_error = `${r.error}: ${JSON.stringify(r.data).slice(0, 300)}`;
            break;
          }
          const j = r.data as {
            orders?: Array<{
              id: string;
              created_at?: string;
              state?: string;
              total_money?: { amount?: number };
              location_id?: string;
              source?: { name?: string };
            }>;
            cursor?: string;
          };
          for (const o of j.orders ?? []) {
            diag.orders.push({
              id: o.id,
              created_at: o.created_at ?? null,
              state: o.state ?? null,
              total_money_cents: o.total_money?.amount ?? null,
              location_id: o.location_id ?? null,
              source_name: o.source?.name ?? null,
            });
          }
          cursor = j.cursor;
          if (!cursor) break;
        }
      }

      // Invoices — POST /v2/invoices/search
      if (locIds.length > 0) {
        let cursor: string | undefined;
        for (let i = 0; i < 10; i++) {
          const body: Record<string, unknown> = {
            query: {
              filter: { location_ids: locIds, customer_ids: [cid] },
              sort: { field: "INVOICE_SORT_DATE", order: "DESC" },
            },
            limit: 200,
          };
          if (cursor) body.cursor = cursor;
          const r = await sq(token, "POST", "/v2/invoices/search", body);
          if (r.error) {
            diag.invoices_error = `${r.error}: ${JSON.stringify(r.data).slice(0, 300)}`;
            break;
          }
          const j = r.data as {
            invoices?: Array<{
              id: string;
              status?: string;
              created_at?: string;
              title?: string;
              invoice_number?: string;
            }>;
            cursor?: string;
          };
          for (const inv of j.invoices ?? []) {
            diag.invoices.push({
              id: inv.id,
              status: inv.status ?? null,
              created_at: inv.created_at ?? null,
              title: inv.title ?? null,
              invoice_number: inv.invoice_number ?? null,
            });
          }
          cursor = j.cursor;
          if (!cursor) break;
        }
      }

      customers.push(diag);
    }

    // Overlap analysis (only meaningful when exactly 2)
    let overlap: SquareDiagnosticResult["overlap"] = null;
    if (customers.length === 2) {
      const [a, b] = customers;
      const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
      const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
      const aBooks = new Set(a.bookings.map((x) => x.id));
      const aOrders = new Set(a.orders.map((x) => x.id));
      const aInv = new Set(a.invoices.map((x) => x.id));
      overlap = {
        shared_email:
          !!a.profile?.email_address &&
          norm(a.profile?.email_address) === norm(b.profile?.email_address),
        shared_phone:
          !!digits(a.profile?.phone_number) &&
          digits(a.profile?.phone_number) === digits(b.profile?.phone_number),
        same_first_name:
          !!norm(a.profile?.given_name) &&
          norm(a.profile?.given_name) === norm(b.profile?.given_name),
        same_last_name:
          !!norm(a.profile?.family_name) &&
          norm(a.profile?.family_name) === norm(b.profile?.family_name),
        shared_booking_ids: b.bookings.map((x) => x.id).filter((id) => aBooks.has(id)),
        shared_order_ids: b.orders.map((x) => x.id).filter((id) => aOrders.has(id)),
        shared_invoice_ids: b.invoices.map((x) => x.id).filter((id) => aInv.has(id)),
      };
    }

    return { location_ids: locIds, customers, overlap };
  });
