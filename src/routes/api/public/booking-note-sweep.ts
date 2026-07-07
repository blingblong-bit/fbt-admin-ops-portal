import { createFileRoute } from "@tanstack/react-router";

// TEMPORARY diagnostic: sweep past Square bookings and classify seller_note against N-of-M pattern.
// Auth: caller must pass `x-diag-token` header equal to ADMIN_DIAG_TOKEN.

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

type SquareBooking = {
  id: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
  seller_note?: string | null;
};

export const Route = createFileRoute("/api/public/booking-note-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ADMIN_DIAG_TOKEN;
        if (!expected) return new Response("no token configured", { status: 500 });
        if (request.headers.get("x-diag-token") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
        if (!token) return new Response("no square token", { status: 500 });

        // Load linked clients from DB
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const linkedIds = new Set<string>();
        const nameById = new Map<string, string>();
        let from = 0;
        const step = 1000;
        for (;;) {
          const { data, error } = await supabaseAdmin
            .from("clients")
            .select("id, first_name, last_name, square_customer_id")
            .not("square_customer_id", "is", null)
            .range(from, from + step - 1);
          if (error) return new Response(`db error: ${error.message}`, { status: 500 });
          if (!data || data.length === 0) break;
          for (const c of data) {
            if (c.square_customer_id) {
              linkedIds.add(c.square_customer_id);
              nameById.set(
                c.square_customer_id,
                `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
              );
            }
          }
          if (data.length < step) break;
          from += step;
        }

        // Sweep past bookings via GET /v2/bookings paginated. Square's default
        // window is 31 days from start_at_min (which defaults to "now"), so we
        // iterate month-by-month backwards to cover history.
        const now = new Date();
        const MONTHS_BACK = 30;
        let scanned = 0;
        let pages = 0;
        const latestByCustomer = new Map<
          string,
          { seller_note: string | null; start_at: string; booking_id: string; status: string | null }
        >();

        for (let m = 0; m < MONTHS_BACK; m++) {
          const maxD = new Date(now);
          maxD.setUTCMonth(maxD.getUTCMonth() - m);
          const minD = new Date(maxD);
          minD.setUTCMonth(minD.getUTCMonth() - 1);
          const startMax = maxD.toISOString();
          const startMin = minD.toISOString();
          let cursor: string | undefined;
          for (let p = 0; p < 50; p++) {
            const url = new URL(`${SQUARE_BASE}/v2/bookings`);
            url.searchParams.set("limit", "200");
            url.searchParams.set("start_at_min", startMin);
            url.searchParams.set("start_at_max", startMax);
            if (cursor) url.searchParams.set("cursor", cursor);
            const r = await fetch(url.toString(), {
              headers: {
                Authorization: `Bearer ${token}`,
                "Square-Version": SQUARE_VERSION,
              },
            });
            pages++;
            if (!r.ok) {
              const t = await r.text();
              return new Response(
                JSON.stringify({ error: `HTTP ${r.status}`, body: t.slice(0, 400), window: [startMin, startMax], pages, scanned }),
                { status: 500, headers: { "content-type": "application/json" } },
              );
            }
            const j = (await r.json()) as { bookings?: SquareBooking[]; cursor?: string };
            for (const b of j.bookings ?? []) {
              scanned++;
              if (!b.customer_id || !linkedIds.has(b.customer_id) || !b.start_at) continue;
              const prev = latestByCustomer.get(b.customer_id);
              if (!prev || b.start_at > prev.start_at) {
                latestByCustomer.set(b.customer_id, {
                  seller_note: b.seller_note ?? null,
                  start_at: b.start_at,
                  booking_id: b.id,
                  status: b.status ?? null,
                });
              }
            }
            cursor = j.cursor;
            if (!cursor) break;
          }
        }


        // Also fetch upcoming bookings so we can compute union/overlap.
        const upcomingCustomerIds = new Set<string>();
        {
          let cursor: string | undefined;
          for (let p = 0; p < 50; p++) {
            const url = new URL(`${SQUARE_BASE}/v2/bookings`);
            url.searchParams.set("limit", "200");
            if (cursor) url.searchParams.set("cursor", cursor);
            const r = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
            });
            if (!r.ok) break;
            const j = (await r.json()) as { bookings?: SquareBooking[]; cursor?: string };
            for (const b of j.bookings ?? []) {
              if (b.customer_id && linkedIds.has(b.customer_id)) upcomingCustomerIds.add(b.customer_id);
            }
            cursor = j.cursor;
            if (!cursor) break;
          }
        }
        const pastCustomerIds = new Set(latestByCustomer.keys());
        const additional = [...pastCustomerIds].filter((x) => !upcomingCustomerIds.has(x)).length;
        const overlap = [...pastCustomerIds].filter((x) => upcomingCustomerIds.has(x)).length;


        const trimmedRe = /^\s*\d+\s+of\s+\d+\s*$/i;
        let exact = 0;
        let whitespace = 0;
        let blank = 0;
        const deviations: Array<{ name: string; customer_id: string; seller_note: string; status: string | null; start_at: string }> = [];
        const whitespaceNames: string[] = [];

        for (const [cid, info] of latestByCustomer) {
          const note = info.seller_note;
          if (note == null || note.trim() === "") {
            blank++;
            continue;
          }
          if (strictRe.test(note)) {
            exact++;
          } else if (trimmedRe.test(note)) {
            whitespace++;
            whitespaceNames.push(nameById.get(cid) ?? cid);
          } else {
            deviations.push({
              name: nameById.get(cid) ?? cid,
              customer_id: cid,
              seller_note: note,
              status: info.status,
              start_at: info.start_at,
            });
          }
        }

        return new Response(
          JSON.stringify({
            linked_clients: linkedIds.size,
            pages_fetched: pages + 1,
            bookings_scanned: scanned,
            covered_clients: latestByCustomer.size,
            distribution: {
              exact_N_of_M: exact,
              whitespace_variant: whitespace,
              blank_or_null: blank,
              true_deviations: deviations.length,
            },
            whitespace_variant_names: whitespaceNames,
            deviations,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
