import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { fetchSquareBookings } from "@/lib/schedule.functions";
import { buildSequence, isSupersededCancellation, parseVisitNote } from "@/lib/square-visit-audit";

// TEMPORARY read-only diagnostic. Signed with SQUARE_WEBHOOK_SIGNATURE_KEY. Writes nothing.
export const Route = createFileRoute("/api/public/week-diag")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        if (!key) return new Response("no key", { status: 500 });
        const body = await request.text();
        const sig = Buffer.from(request.headers.get("x-diag-sig") ?? "");
        const exp = Buffer.from(createHmac("sha256", key).update(body).digest("hex"));
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) return new Response("bad sig", { status: 401 });
        const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "";
        const { start, end } = JSON.parse(body) as { start: string; end: string };
        const chunks: [string, string][] = [];
        const DAY = 86_400_000;
        for (let s = Date.parse(start); s < Date.parse(end); s += 30 * DAY)
          chunks.push([new Date(s).toISOString(), new Date(Math.min(s + 30 * DAY, Date.parse(end))).toISOString()]);
        const byC = new Map<string, any[]>();
        const seen = new Set<string>();
        for (const [a, b] of chunks) {
          const r = await fetchSquareBookings(token, a, b);
          if (r.error) return new Response(JSON.stringify({ error: r.error }), { status: 502 });
          for (const bk of r.bookings) {
            if (!bk.customer_id || !bk.start_at || seen.has(bk.id)) continue;
            seen.add(bk.id);
            const l = byC.get(bk.customer_id) ?? [];
            l.push(bk);
            byC.set(bk.customer_id, l);
          }
        }
        const nowIso = new Date().toISOString();
        const out: any[] = [];
        for (const [cid, list] of byC) {
          const seq = buildSequence(
            list.map((b) => ({ id: b.id, start_at: b.start_at, status: b.status, seller_note: b.seller_note, customer_note: b.customer_note })),
            nowIso,
          );
          for (const e of seq) {
            const raw = list.find((b) => b.id === e.booking_id);
            out.push({
              customer_id: cid,
              booking_id: e.booking_id,
              start_at: e.date,
              status: e.status ?? null,
              note: e.note ? `${e.note.n}/${e.note.total}` : null,
              parsed_again: parseVisitNote(raw?.seller_note ?? raw?.customer_note) ? true : false,
              superseded: e.note ? isSupersededCancellation(seq, e) : false,
            });
          }
        }
        return new Response(JSON.stringify({ bookings: out }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});
