import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Temporary read-only debug endpoint for the Square diagnostic. Auth: caller
// must provide an HMAC-SHA256 of the body using SQUARE_WEBHOOK_SIGNATURE_KEY
// in the `x-diag-sig` header. Read-only — never writes to Square or to Admin.

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

export const Route = createFileRoute("/api/public/square-diag")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        if (!key) return new Response("no key", { status: 500 });
        const body = await request.text();
        const sig = request.headers.get("x-diag-sig") ?? "";
        const expected = createHmac("sha256", key).update(body).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("bad sig", { status: 401 });
        }
        const { customer_ids } = JSON.parse(body) as { customer_ids: string[] };
        const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
        if (!token) return new Response("no square token", { status: 500 });

        const H = {
          Authorization: `Bearer ${token}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        } as const;

        // Locations
        const locR = await fetch(`${SQUARE_BASE}/v2/locations`, { headers: H });
        const locJ = (await locR.json()) as {
          locations?: Array<{ id: string; status?: string }>;
        };
        const locIds = (locJ.locations ?? [])
          .filter((l) => (l.status ?? "ACTIVE") === "ACTIVE")
          .map((l) => l.id);

        const out: Record<string, unknown> = { location_ids: locIds, customers: [] };
        const customersOut: unknown[] = [];

        for (const cid of customer_ids) {
          const rec: Record<string, unknown> = { customer_id: cid };

          // Profile
          const pr = await fetch(
            `${SQUARE_BASE}/v2/customers/${encodeURIComponent(cid)}`,
            { headers: H },
          );
          const pt = await pr.text();
          rec.profile_status = pr.status;
          try {
            rec.profile = JSON.parse(pt);
          } catch {
            rec.profile_raw = pt.slice(0, 400);
          }

          // Bookings
          {
            const bookings: unknown[] = [];
            let cursor: string | undefined;
            let err: string | undefined;
            for (let i = 0; i < 20; i++) {
              const url = new URL(`${SQUARE_BASE}/v2/bookings`);
              url.searchParams.set("customer_id", cid);
              url.searchParams.set("limit", "200");
              if (cursor) url.searchParams.set("cursor", cursor);
              const r = await fetch(url.toString(), { headers: H });
              const t = await r.text();
              if (!r.ok) {
                err = `HTTP ${r.status}: ${t.slice(0, 200)}`;
                break;
              }
              const j = JSON.parse(t) as {
                bookings?: Array<Record<string, unknown>>;
                cursor?: string;
              };
              for (const bk of j.bookings ?? []) {
                bookings.push({
                  id: bk.id,
                  status: bk.status,
                  start_at: bk.start_at,
                  created_at: bk.created_at,
                  location_id: bk.location_id,
                });
              }
              cursor = j.cursor;
              if (!cursor) break;
            }
            rec.bookings = bookings;
            if (err) rec.bookings_error = err;
          }

          // Orders
          if (locIds.length > 0) {
            const orders: unknown[] = [];
            let cursor: string | undefined;
            let err: string | undefined;
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
              const r = await fetch(`${SQUARE_BASE}/v2/orders/search`, {
                method: "POST",
                headers: H,
                body: JSON.stringify(body),
              });
              const t = await r.text();
              if (!r.ok) {
                err = `HTTP ${r.status}: ${t.slice(0, 300)}`;
                break;
              }
              const j = JSON.parse(t) as {
                orders?: Array<Record<string, unknown>>;
                cursor?: string;
              };
              for (const o of j.orders ?? []) {
                orders.push({
                  id: o.id,
                  created_at: o.created_at,
                  state: o.state,
                  total_money: o.total_money,
                  location_id: o.location_id,
                  source: o.source,
                });
              }
              cursor = j.cursor;
              if (!cursor) break;
            }
            rec.orders = orders;
            if (err) rec.orders_error = err;
          }

          // Invoices
          if (locIds.length > 0) {
            const invoices: unknown[] = [];
            let cursor: string | undefined;
            let err: string | undefined;
            for (let i = 0; i < 10; i++) {
              const body: Record<string, unknown> = {
                query: {
                  filter: { location_ids: locIds, customer_ids: [cid] },
                  sort: { field: "INVOICE_SORT_DATE", order: "DESC" },
                },
                limit: 200,
              };
              if (cursor) body.cursor = cursor;
              const r = await fetch(`${SQUARE_BASE}/v2/invoices/search`, {
                method: "POST",
                headers: H,
                body: JSON.stringify(body),
              });
              const t = await r.text();
              if (!r.ok) {
                err = `HTTP ${r.status}: ${t.slice(0, 300)}`;
                break;
              }
              const j = JSON.parse(t) as {
                invoices?: Array<Record<string, unknown>>;
                cursor?: string;
              };
              for (const inv of j.invoices ?? []) {
                invoices.push({
                  id: inv.id,
                  status: inv.status,
                  created_at: inv.created_at,
                  title: inv.title,
                  invoice_number: inv.invoice_number,
                  primary_recipient: inv.primary_recipient,
                });
              }
              cursor = j.cursor;
              if (!cursor) break;
            }
            rec.invoices = invoices;
            if (err) rec.invoices_error = err;
          }

          customersOut.push(rec);
        }
        out.customers = customersOut;
        return new Response(JSON.stringify(out), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
