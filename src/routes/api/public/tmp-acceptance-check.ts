import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/tmp-acceptance-check")({
  server: { handlers: { GET: async ({ request }) => {
    if (new URL(request.url).searchParams.get("k") !== "6081b4880820ed73f35e64d326f371c3") return new Response("no", { status: 404 });
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const S = await import("@/lib/schedule.functions");
    const { countsAsMissedCheckIn } = await import("@/lib/effective-visit-state");
    const tables = ["clients","square_payments","client_activities","dues_messages","renewal_campaigns","renewal_messages"];
    const snap = async () => { const o: Record<string, unknown> = {}; for (const t of tables) {
      const rows: any[] = []; for (let f = 0; ; f += 1000) { const { data, error } = await (sb as any).from(t).select("*").order("id").range(f, f + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) break; }
      const buf = new TextEncoder().encode(JSON.stringify(rows));
      const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
      const latest = rows.reduce((m, r) => { const v = r.updated_at ?? r.created_at ?? ""; return v > m ? v : m; }, "");
      o[t] = { count: rows.length, sha: h, latest }; } return o; };
    const before = await snap();
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN!;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const d = (n: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const { appts } = await S.loadAppointmentsForRange(sb as any, token, d(-15), d(-1));
    const now = Date.now();
    const cands = appts.filter((a) => a.client && !S.isCancelledStatus(a.status) && !S.isNoShowStatus(a.status) && new Date(a.start_at).getTime() <= now);
    const checked = new Set(await S.resolveCheckedInBookingIds(sb as any, cands.map((a) => ({ booking_id: a.booking_id, client_id: a.client!.id, start_at: a.start_at }))));
    const dismissed = await S.resolveDismissedBookingIds(sb as any, cands.map((a) => a.booking_id));
    const unrecorded = cands.filter((a) => !checked.has(a.booking_id) && !dismissed.has(a.booking_id));
    const mode = (a: any) => a.client.visit ? a.client.visit.mode : "no_tracking";
    const tally = (xs: any[]) => xs.reduce((m, a) => { m[mode(a)] = (m[mode(a)] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const missed = unrecorded.filter((a) => countsAsMissedCheckIn(a.client!.visit));
    const after = await snap();
    return Response.json({ window: [d(-15), d(-1)], unrecorded_before_change: unrecorded.length, unrecorded_by_mode: tally(unrecorded), missed_now: missed.length, missed_by_mode: tally(missed),
      square_in_missed: missed.filter((a) => ["square","square_review"].includes(mode(a))).length, before, after, identical: JSON.stringify(before) === JSON.stringify(after),
      flags: { SMS_DUES_SENDING_ENABLED: process.env.SMS_DUES_SENDING_ENABLED ?? "(unset)", RENEWAL_AUTO_TEXT_ENABLED: process.env.RENEWAL_AUTO_TEXT_ENABLED ?? "(unset)" } });
  } } },
});
