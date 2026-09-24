import { createFileRoute } from "@tanstack/react-router";
import { classifyClient, parseBookings, type AuditBooking, type AuditRow } from "@/lib/square-visit-audit";

// TEMPORARY read-only audit. Reads Square bookings and Hub clients; writes nothing.
// Guarded by a one-shot token; delete this file after the audit.
const ONESHOT_TOKEN = "visit-audit-2026-09-24-7c41e9";
const SQUARE_BASE = "https://connect.squareup.com";
const DAY = 86_400_000;

export const Route = createFileRoute("/api/public/square-visit-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("x-oneshot") !== ONESHOT_TOKEN) return new Response("forbidden", { status: 403 });
        const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "")
          .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
          // eslint-disable-next-line no-control-regex
          .replace(/[^\x20-\x7E]/g, "");
        if (!token) return new Response("no token", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: clients, error } = await supabaseAdmin
          .from("clients")
          .select("id, first_name, last_name, square_customer_id, visits_used, package_total_visits, payment_model, status")
          .is("deleted_at", null)
          .neq("status", "archived")
          .gt("package_total_visits", 0)
          .limit(5000);
        if (error) return new Response(error.message, { status: 500 });
        const pkgClients = (clients ?? []).filter((c) => c.payment_model !== "pay_per_visit");

        // All bookings from -180d to +90d, 31-day windows.
        const byCustomer = new Map<string, AuditBooking[]>();
        const now = Date.now();
        const errors: string[] = [];
        for (let off = -180; off < 90; off += 31) {
          let cursor: string | undefined;
          for (let i = 0; i < 50; i++) {
            const url = new URL(`${SQUARE_BASE}/v2/bookings`);
            url.searchParams.set("limit", "200");
            url.searchParams.set("start_at_min", new Date(now + off * DAY).toISOString());
            url.searchParams.set("start_at_max", new Date(now + Math.min(off + 31, 90) * DAY).toISOString());
            if (cursor) url.searchParams.set("cursor", cursor);
            const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Square-Version": "2024-10-17" } });
            if (!r.ok) { errors.push(`${r.status} ${(await r.text()).slice(0, 200)}`); break; }
            const j = (await r.json()) as { bookings?: Array<AuditBooking & { customer_id?: string; status?: string }>; cursor?: string };
            for (const bk of j.bookings ?? []) {
              if (!bk.customer_id || /CANCEL|DECLINED|NO_SHOW/i.test(bk.status ?? "")) continue;
              const list = byCustomer.get(bk.customer_id) ?? [];
              list.push(bk);
              byCustomer.set(bk.customer_id, list);
            }
            cursor = j.cursor;
            if (!cursor) break;
          }
        }

        const nowIso = new Date(now).toISOString();
        const rows: AuditRow[] = pkgClients.map((c) => {
          const parsed = parseBookings(c.square_customer_id ? byCustomer.get(c.square_customer_id) ?? [] : [], nowIso);
          const r = classifyClient(c.visits_used ?? 0, c.package_total_visits ?? 0, parsed);
          return {
            client_id: c.id,
            name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
            hub: `${c.visits_used ?? 0}/${c.package_total_visits}`,
            latest_square: r.latest ? `${r.latest.n}/${r.latest.total}` : null,
            future: parsed.filter((p) => !p.past).map((p) => `${p.n}/${p.total}`),
            classification: r.classification,
            reason: c.square_customer_id ? r.reason : "No Square customer linked",
            pattern: c.square_customer_id ? r.pattern : "no_square_link",
          };
        });
        const count = (k: string) => rows.filter((r) => r.classification === k).length;
        const patterns: Record<string, number> = {};
        for (const r of rows) patterns[r.pattern] = (patterns[r.pattern] ?? 0) + 1;
        return Response.json({
          checked: rows.length,
          synced: count("Square synced"),
          fallback: count("Hub fallback"),
          review: count("Needs review"),
          usable_pct: rows.length ? Math.round((rows.filter((r) => r.pattern !== "no_notes" && r.pattern !== "no_square_link").length / rows.length) * 100) : 0,
          patterns,
          errors,
          rows,
        });
      },
    },
  },
});
