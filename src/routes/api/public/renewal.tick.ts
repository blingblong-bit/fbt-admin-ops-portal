// Cron-driven renewal SMS engine.
//
// Triggered by pg_cron every 15 minutes. Does three things:
//   1. Detect new "last visit on package" clients and start a campaign (send #1)
//   2. Send #2 (on the day of the last visit) and #3 (day after) for active
//      campaigns with no reply, once per campaign per day, only in the send
//      window (~10:00 America/Chicago).
//   3. Auto-clear campaigns whose client has started a new package.
//
// All SMS goes through the Lovable Twilio connector gateway.
// Required env:
//   - LOVABLE_API_KEY                    (auto-set by Lovable Cloud)
//   - TWILIO_API_KEY                     (set by linking the Twilio connector)
//   - RENEWAL_TWILIO_FROM_NUMBER         (the dedicated second Twilio number)
//   - RENEWAL_NOTIFY_TO_NUMBER           (dad's cell)
//   - SQUARE_PRODUCTION_ACCESS_TOKEN     (already configured)

import { createFileRoute } from "@tanstack/react-router";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";
const CLINIC_TZ = "America/Chicago";
const SEND_HOUR_LOCAL = 10; // 10am clinic-local for msg 2/3
const SEND_WINDOW_HOURS = 2; // any cron tick between 10am–noon will send
const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio/Messages.json";

function ymdInTz(d: Date, tz = CLINIC_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function hourInTz(d: Date, tz = CLINIC_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, hour: "2-digit",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  return h === 24 ? 0 : h;
}
function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}
function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}
function normalizePhone(s: string | null | undefined): string {
  const d = digitsOnly(s);
  if (!d) return "";
  // US 10-digit → +1XXXXXXXXXX
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

type Client = {
  id: string; first_name: string; last_name: string; phone: string | null;
  square_customer_id: string | null;
  package_total_visits: number; visits_used: number | null;
  package_price: number; amount_paid: number;
  package_start_date: string | null;
  payment_model: string | null;
  deleted_at: string | null;
};
type Campaign = {
  id: string; client_id: string;
  package_start_date_snapshot: string | null;
  package_total_visits_snapshot: number;
  last_visit_date: string | null;
  status: string;
  sends_count: number;
  last_sent_at: string | null;
  reply_at: string | null;
  created_at: string;
};

async function sendSms(to: string, body: string): Promise<{ sid: string | null; error: string | null }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const from = process.env.RENEWAL_TWILIO_FROM_NUMBER;
  if (!lovableKey || !twilioKey) return { sid: null, error: "Twilio connector not linked (LOVABLE_API_KEY / TWILIO_API_KEY missing)" };
  if (!from) return { sid: null, error: "RENEWAL_TWILIO_FROM_NUMBER not set" };
  const res = await fetch(TWILIO_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  const text = await res.text();
  if (!res.ok) return { sid: null, error: `Twilio ${res.status}: ${text.slice(0, 400)}` };
  try {
    const j = JSON.parse(text) as { sid?: string };
    return { sid: j.sid ?? null, error: null };
  } catch {
    return { sid: null, error: `Twilio parse error: ${text.slice(0, 200)}` };
  }
}

// Fetch a customer's upcoming ACCEPTED bookings sorted by start_at.
async function fetchUpcomingBookings(token: string, customerId: string): Promise<{ start_at: string }[]> {
  const url = new URL(`${SQUARE_BASE}/v2/bookings`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("customer_id", customerId);
  const nowIso = new Date().toISOString();
  url.searchParams.set("start_at_min", nowIso);
  url.searchParams.set("start_at_max", new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString());
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { bookings?: Array<{ start_at?: string; status?: string }> };
    const rows = (json.bookings ?? [])
      .filter((b) => b.start_at && (b.status ?? "").toUpperCase() === "ACCEPTED")
      .map((b) => ({ start_at: b.start_at as string }))
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    return rows;
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/public/renewal/tick")({
  server: {
    handlers: {
      GET: async () => {
        // Version probe so we can confirm deploys.
        return Response.json({ version: "renewal-tick-v1" });
      },
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const squareToken = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "")
          .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
          .trim()
          // eslint-disable-next-line no-control-regex
          .replace(/[^\x20-\x7E]/g, "");
        if (!squareToken) {
          return Response.json({ ok: false, error: "SQUARE_PRODUCTION_ACCESS_TOKEN missing" }, { status: 500 });
        }

        const now = new Date();
        const todayLocal = ymdInTz(now);
        const localHour = hourInTz(now);
        const inSendWindow = localHour >= SEND_HOUR_LOCAL && localHour < SEND_HOUR_LOCAL + SEND_WINDOW_HOURS;

        const summary = {
          checked_clients: 0,
          candidates: 0,
          new_campaigns: 0,
          followups_sent: 0,
          moved_to_manual: 0,
          auto_renewed: 0,
          send_window: inSendWindow,
          local_hour: localHour,
          errors: [] as string[],
        };

        // --- 1. AUTO-CLEAR: any active/yes campaign whose client started a new package -----
        {
          const { data: openCampaigns } = await supabaseAdmin
            .from("renewal_campaigns")
            .select("id, client_id, package_start_date_snapshot, package_total_visits_snapshot, created_at")
            .in("status", ["active", "yes", "manual_review"]);
          for (const c of (openCampaigns ?? []) as Campaign[]) {
            const { data: cli } = await supabaseAdmin
              .from("clients")
              .select("package_start_date, package_total_visits, visits_used")
              .eq("id", c.client_id)
              .maybeSingle();
            if (!cli) continue;
            const startedNewPkg = cli.package_start_date &&
              (!c.package_start_date_snapshot || cli.package_start_date > c.package_start_date_snapshot);
            const packageChanged = cli.package_total_visits !== c.package_total_visits_snapshot;
            const visitsReset = (cli.visits_used ?? 0) < c.package_total_visits_snapshot - 1;
            if (startedNewPkg || packageChanged || visitsReset) {
              await supabaseAdmin.from("renewal_campaigns")
                .update({ status: "renewed" }).eq("id", c.id);
              summary.auto_renewed++;
            }
          }
        }

        // --- 2. FOLLOW-UPS on existing active campaigns (msg #2 and #3) -----
        {
          const { data: active } = await supabaseAdmin
            .from("renewal_campaigns")
            .select("id, client_id, package_start_date_snapshot, package_total_visits_snapshot, last_visit_date, status, sends_count, last_sent_at, reply_at, created_at")
            .eq("status", "active");
          for (const c of (active ?? []) as Campaign[]) {
            if (c.reply_at) continue;
            if (!c.last_visit_date) continue;
            const lastSentDay = c.last_sent_at ? ymdInTz(new Date(c.last_sent_at)) : null;
            if (lastSentDay === todayLocal) continue; // already sent today
            if (!inSendWindow) continue;

            let nextSeq = 0;
            if (c.sends_count === 1 && todayLocal >= c.last_visit_date) {
              nextSeq = 2;
            } else if (c.sends_count === 2 && todayLocal >= addDaysYmd(c.last_visit_date, 1)) {
              nextSeq = 3;
            }
            if (nextSeq === 0) continue;

            // pull client for phone + name
            const { data: cli } = await supabaseAdmin
              .from("clients")
              .select("first_name, last_name, phone")
              .eq("id", c.client_id)
              .maybeSingle();
            if (!cli || !cli.phone) {
              summary.errors.push(`campaign ${c.id}: missing client/phone`);
              continue;
            }
            const to = normalizePhone(cli.phone);
            const body = nextSeq === 2
              ? `Hi ${cli.first_name} — just checking in! Today's your last visit on your current package. Reply YES to renew.`
              : `Hey ${cli.first_name} — one more nudge on renewing your package. Reply YES to renew, or NO if you're done for now.`;
            const { sid, error } = await sendSms(to, body);
            await supabaseAdmin.from("renewal_messages").insert({
              campaign_id: c.id,
              direction: "out",
              sequence_index: nextSeq,
              to_number: to,
              from_number: process.env.RENEWAL_TWILIO_FROM_NUMBER ?? null,
              body,
              twilio_sid: sid,
              error,
            });
            if (error) {
              summary.errors.push(`send msg${nextSeq} to ${c.client_id}: ${error}`);
              continue;
            }
            const newSendsCount = c.sends_count + 1;
            const newStatus = newSendsCount >= 3 ? "manual_review" : "active";
            await supabaseAdmin.from("renewal_campaigns")
              .update({ sends_count: newSendsCount, last_sent_at: new Date().toISOString(), status: newStatus })
              .eq("id", c.id);
            summary.followups_sent++;
            if (newStatus === "manual_review") summary.moved_to_manual++;
          }
        }

        // --- 3. DETECT new candidates and send msg #1 -----
        // Pull all non-archived, non-pay-per-visit clients on their last visit.
        const { data: allCandidates } = await supabaseAdmin
          .from("clients")
          .select("id, first_name, last_name, phone, square_customer_id, package_total_visits, visits_used, package_price, amount_paid, package_start_date, payment_model, deleted_at")
          .is("deleted_at", null)
          .neq("payment_model", "pay_per_visit")
          .gt("package_total_visits", 0);

        for (const cli of (allCandidates ?? []) as Client[]) {
          summary.checked_clients++;
          const used = cli.visits_used ?? 0;
          if (used !== cli.package_total_visits - 1) continue;
          const owed = Number(cli.package_price ?? 0) - Number(cli.amount_paid ?? 0);
          if (owed > 0.001) continue;
          if (!cli.phone) continue;
          if (!cli.square_customer_id) continue;
          summary.candidates++;

          // Skip if we already have any non-terminal campaign for this snapshot.
          const { data: existing } = await supabaseAdmin
            .from("renewal_campaigns")
            .select("id, status")
            .eq("client_id", cli.id)
            .eq("package_total_visits_snapshot", cli.package_total_visits)
            .order("created_at", { ascending: false })
            .limit(1);
          if (existing && existing.length > 0) {
            const s = existing[0].status;
            if (s !== "renewed" && s !== "cancelled") continue;
          }

          // Need at least 2 upcoming bookings: the "last visit" AND a further one.
          const bookings = await fetchUpcomingBookings(squareToken, cli.square_customer_id);
          if (bookings.length < 2) continue;
          const lastVisitYmd = ymdInTz(new Date(bookings[0].start_at));

          const to = normalizePhone(cli.phone);
          const body = `Hi ${cli.first_name} — looks like ${prettyDate(lastVisitYmd)} is your last visit on your current package! Reply YES if you'd like to renew.`;

          const { data: created, error: insErr } = await supabaseAdmin
            .from("renewal_campaigns")
            .insert({
              client_id: cli.id,
              package_start_date_snapshot: cli.package_start_date,
              package_total_visits_snapshot: cli.package_total_visits,
              last_visit_date: lastVisitYmd,
              status: "active",
              sends_count: 0,
            })
            .select("id")
            .single();
          if (insErr || !created) {
            summary.errors.push(`create campaign for ${cli.id}: ${insErr?.message ?? "unknown"}`);
            continue;
          }

          const { sid, error } = await sendSms(to, body);
          await supabaseAdmin.from("renewal_messages").insert({
            campaign_id: created.id,
            direction: "out",
            sequence_index: 1,
            to_number: to,
            from_number: process.env.RENEWAL_TWILIO_FROM_NUMBER ?? null,
            body,
            twilio_sid: sid,
            error,
          });
          if (error) {
            summary.errors.push(`send msg1 to ${cli.id}: ${error}`);
            continue;
          }
          await supabaseAdmin.from("renewal_campaigns")
            .update({ sends_count: 1, last_sent_at: new Date().toISOString() })
            .eq("id", created.id);
          summary.new_campaigns++;
        }

        return Response.json({ ok: true, summary });
      },
    },
  },
});
