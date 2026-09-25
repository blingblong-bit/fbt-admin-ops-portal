import { createFileRoute } from "@tanstack/react-router";

// TEMPORARY read-only probe — delete after use. Never writes anywhere.
const PROBE_TOKEN = "probe-7f3c9a1e2b8d4f60a5e1c9d2b7a4e8f1";
const BASE = "https://connect.squareup.com";

export const Route = createFileRoute("/api/public/tmp-booking-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        if (u.searchParams.get("t") !== PROBE_TOKEN) return new Response("no", { status: 401 });
        const cid = u.searchParams.get("cid") ?? "";
        const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
        if (!token) return new Response("no token", { status: 500 });
        const H = { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17" };
        const list = async (params: Record<string, string>) => {
          const out: any[] = [];
          let cursor: string | undefined;
          for (let i = 0; i < 20; i++) {
            const url = new URL(`${BASE}/v2/bookings`);
            url.searchParams.set("limit", "200");
            for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
            if (cursor) url.searchParams.set("cursor", cursor);
            const r = await fetch(url.toString(), { headers: H });
            const j: any = await r.json();
            if (!r.ok) return { error: j, out };
            out.push(...(j.bookings ?? []));
            cursor = j.cursor;
            if (!cursor) break;
          }
          return { error: null, out };
        };
        const byCustomer = await list({ customer_id: cid, start_at_min: "2026-08-01T00:00:00Z", start_at_max: "2026-08-31T00:00:00Z" });
        const byCustomer2 = await list({ customer_id: cid, start_at_min: "2026-08-31T00:00:00Z", start_at_max: "2026-09-30T00:00:00Z" });
        const byCustomer3 = await list({ customer_id: cid, start_at_min: "2026-09-30T00:00:00Z", start_at_max: "2026-10-15T00:00:00Z" });
        const windowIds: string[] = [];
        for (const [a, b] of [["2026-08-01", "2026-08-31"], ["2026-08-31", "2026-09-30"], ["2026-09-30", "2026-10-15"]]) {
          const w = await list({ start_at_min: `${a}T00:00:00Z`, start_at_max: `${b}T00:00:00Z` });
          for (const bk of w.out) if (bk.customer_id === cid) windowIds.push(bk.id);
        }
        return Response.json({
          errors: [byCustomer.error, byCustomer2.error, byCustomer3.error],
          bookings: [...byCustomer.out, ...byCustomer2.out, ...byCustomer3.out],
          windowIds,
        });
      },
    },
  },
});
