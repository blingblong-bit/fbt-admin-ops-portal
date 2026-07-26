import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

function parseNote(note: string | null | undefined): { used: number; total: number } | null {
  if (!note) return null;
  const rx1 = /^\s*(\d+)\s+of\s+(\d+)\s*$/i;
  const rx2 = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
  let m = note.match(rx1);
  if (!m) {
    const first = note.split("\n")[0].trim();
    m = first.match(rx1);
  }
  if (!m) m = note.match(rx2);
  if (!m) return null;
  return { used: Number(m[1]), total: Number(m[2]) };
}

export const Route = createFileRoute("/api/public/visit-diff-sweep")({
  server: {
    handlers: {
      GET: async () => Response.json({ version: "with-date-window-v2", has_start_at_min: true }),
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

        const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
        if (!token) return new Response("no square token", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: clients, error } = await supabaseAdmin
          .from("clients")
          .select("id, first_name, last_name, square_customer_id, visits_used, package_total_visits")
          .is("deleted_at", null)
          .not("square_customer_id", "is", null);
        if (error) return new Response(error.message, { status: 500 });

        void SQUARE_VERSION;


        const disagreements: unknown[] = [];
        const errors: unknown[] = [];
        const allNotes: unknown[] = [];
        let scanned = 0;
        let parsed = 0;
        let unparsed = 0;
        let blankNotes = 0;
        let noBooking = 0;


        for (const c of clients ?? []) {
          scanned++;
          const cid = c.square_customer_id as string;
          // Get most recent booking (past or upcoming). Use search with customer filter.
          let latest: { start_at?: string; seller_note?: string | null; id?: string } | null = null;
          let pages = 0;
          let totalBookings = 0;
          try {
            let cursor: string | undefined;
            for (let i = 0; i < 20; i++) {
              const url = new URL(`${SQUARE_BASE}/v2/bookings`);
              url.searchParams.set("customer_id", cid);
              url.searchParams.set("limit", "200");
              url.searchParams.set("start_at_min", new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString());
              url.searchParams.set("start_at_max", new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString());
              if (cursor) url.searchParams.set("cursor", cursor);
              const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
              });
              if (!res.ok) {
                const body = (await res.text()).slice(0, 500);
                errors.push({ client_id: c.id, name: `${c.first_name} ${c.last_name}`, square_customer_id: cid, status: res.status, body });
                break;
              }
              const j = (await res.json()) as { bookings?: Array<{ id?: string; start_at?: string; seller_note?: string | null }>; cursor?: string };
              pages++;
              totalBookings += (j.bookings ?? []).length;
              for (const bk of j.bookings ?? []) {
                if (!latest || (bk.start_at ?? "") > (latest.start_at ?? "")) latest = bk;
              }
              cursor = j.cursor;
              if (!cursor) break;
            }
          } catch (e) {
            errors.push({ client_id: c.id, name: `${c.first_name} ${c.last_name}`, error: String(e) });
            continue;
          }
          void totalBookings;
          void pages;

          if (!latest) {
            noBooking++;
            allNotes.push({
              name: `${c.first_name} ${c.last_name}`,
              square_customer_id: cid,
              latest_booking_at: null,
              raw_note: null,
              parsed: null,
              status: "no_booking",
            });
            continue;
          }
          const note = latest.seller_note ?? null;
          const p = note && note.trim() ? parseNote(note) : null;
          if (!note || !note.trim()) blankNotes++;
          else if (!p) unparsed++;
          else parsed++;

          allNotes.push({
            name: `${c.first_name} ${c.last_name}`,
            square_customer_id: cid,
            latest_booking_at: latest.start_at ?? null,
            raw_note: note,
            parsed: p,
            status: !note || !note.trim() ? "blank" : p ? "parsed" : "unparseable",
          });

          if (p) {
            const hubUsed = c.visits_used ?? null;
            const hubTotal = c.package_total_visits ?? 0;
            if (p.used !== hubUsed || p.total !== hubTotal) {
              disagreements.push({
                client_id: c.id,
                name: `${c.first_name} ${c.last_name}`,
                square_customer_id: cid,
                hub_visits_used: hubUsed,
                hub_total: hubTotal,
                square_note: note,
                square_parsed_used: p.used,
                square_parsed_total: p.total,
                latest_booking_at: latest.start_at ?? null,
              });
            }
          }
        }


        return new Response(
          JSON.stringify(
            {
              scanned,
              parsed,
              unparsed,
              blank_notes: blankNotes,
              no_booking: noBooking,
              disagreement_count: disagreements.length,
              disagreements,
              all_notes: allNotes,
              errors,
            },
            null,
            2,
          ),
          { headers: { "content-type": "application/json" } },
        );

      },
    },
  },
});
