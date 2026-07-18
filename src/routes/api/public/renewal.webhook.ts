// Twilio inbound-SMS webhook for the package-renewal system.
//
// Twilio POSTs application/x-www-form-urlencoded with fields:
//   From, To, Body, MessageSid, AccountSid, ...
//
// We do fuzzy YES/NO matching, act on the reply, and (for YES) fire a
// notification SMS to the owner.
//
// Twilio expects a TwiML XML response. We return an empty <Response/> so
// Twilio doesn't try to auto-reply on our behalf.

import { createFileRoute } from "@tanstack/react-router";

const TWILIO_GATEWAY = "https://connector-gateway.lovable.dev/twilio/Messages.json";

const EMPTY_TWIML_BODY = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function emptyTwimlResponse() {
  return new Response(EMPTY_TWIML_BODY, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}
function last10(s: string | null | undefined): string {
  const d = digitsOnly(s);
  return d.slice(-10);
}
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[!.?,;:'"\s]+/g, " ").trim();
}
const YES_TOKENS = new Set([
  "y", "yes", "yeah", "yep", "yup", "ya", "yea", "sure",
  "ok", "okay", "k", "kk", "please", "yes please", "yasss", "yass",
  "absolutely", "definitely", "sounds good", "sounds great", "sign me up",
  "renew", "yes renew", "yes please renew", "let's do it", "lets do it",
]);
const NO_TOKENS = new Set([
  "n", "no", "nope", "nah", "naw", "no thanks", "no thank you",
  "not now", "not right now", "not this time", "im good", "i'm good",
  "all done", "done", "stop", "unsubscribe",
]);
function classifyReply(body: string): "yes" | "no" | "unclear" {
  const norm = normalize(body);
  if (!norm) return "unclear";
  if (YES_TOKENS.has(norm)) return "yes";
  if (NO_TOKENS.has(norm)) return "no";
  // Fallback: check if first token alone is decisive
  const first = norm.split(" ")[0];
  if (YES_TOKENS.has(first)) return "yes";
  if (NO_TOKENS.has(first)) return "no";
  return "unclear";
}

async function sendOwnerNotification(clientName: string, lastVisitYmd: string | null, clientId: string): Promise<{ error: string | null }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  const from = process.env.RENEWAL_TWILIO_FROM_NUMBER;
  const to = process.env.RENEWAL_NOTIFY_TO_NUMBER;
  if (!lovableKey || !twilioKey) return { error: "Twilio connector not linked" };
  if (!from || !to) return { error: "RENEWAL_TWILIO_FROM_NUMBER or RENEWAL_NOTIFY_TO_NUMBER not set" };
  const link = `https://fbt-admin-ops-portal.lovable.app/clients/${clientId}`;
  const body =
    `Renewal YES: ${clientName}` +
    (lastVisitYmd ? ` (last visit ${lastVisitYmd})` : "") +
    ` — ${link}`;
  const res = await fetch(TWILIO_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) return { error: `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { error: null };
}

export const Route = createFileRoute("/api/public/renewal/webhook")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, version: "renewal-webhook-v1" }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const form = await request.formData();
        const from = String(form.get("From") ?? "");
        const body = String(form.get("Body") ?? "");
        const sid = String(form.get("MessageSid") ?? "");
        const toNum = String(form.get("To") ?? "");

        if (!from || !body) return emptyTwimlResponse();

        // Match From → most recent active/manual_review campaign whose client's
        // phone shares the last-10 digits.
        const fromLast10 = last10(from);
        if (!fromLast10) return emptyTwimlResponse();

        // Find candidate clients by phone match
        const { data: clientMatches } = await supabaseAdmin
          .from("clients")
          .select("id, first_name, last_name, phone")
          .not("phone", "is", null);
        const matchedClient = (clientMatches ?? []).find(
          (c) => last10(c.phone) === fromLast10,
        );
        if (!matchedClient) {
          console.log(`[renewal.webhook] no client match for ${from}`);
          return emptyTwimlResponse();
        }

        // Find their most recent non-terminal campaign
        const { data: campRows } = await supabaseAdmin
          .from("renewal_campaigns")
          .select("id, status, last_visit_date, reply_at")
          .eq("client_id", matchedClient.id)
          .in("status", ["active", "manual_review"])
          .order("created_at", { ascending: false })
          .limit(1);
        const campaign = campRows?.[0];
        if (!campaign) {
          console.log(`[renewal.webhook] no active campaign for client ${matchedClient.id}`);
          // Still log the inbound so we have an audit trail via renewal_messages? Skip — no campaign to attach.
          return emptyTwimlResponse();
        }
        if (campaign.reply_at) {
          console.log(`[renewal.webhook] campaign ${campaign.id} already has a reply`);
          return emptyTwimlResponse();
        }

        // Log inbound
        await supabaseAdmin.from("renewal_messages").insert({
          campaign_id: campaign.id,
          direction: "in",
          sequence_index: null,
          from_number: from,
          to_number: toNum,
          body,
          twilio_sid: sid,
          error: null,
        });

        const kind = classifyReply(body);
        const clientName = `${matchedClient.first_name} ${matchedClient.last_name}`.trim();
        const nowIso = new Date().toISOString();

        if (kind === "yes") {
          const notify = await sendOwnerNotification(clientName, campaign.last_visit_date, matchedClient.id);
          await supabaseAdmin.from("renewal_campaigns").update({
            status: "yes",
            reply_text: body,
            reply_at: nowIso,
            notified_owner_at: notify.error ? null : nowIso,
          }).eq("id", campaign.id);
          if (notify.error) {
            console.error(`[renewal.webhook] owner notify failed: ${notify.error}`);
          }
        } else if (kind === "no") {
          await supabaseAdmin.from("renewal_campaigns").update({
            status: "no",
            reply_text: body,
            reply_at: nowIso,
          }).eq("id", campaign.id);
        } else {
          await supabaseAdmin.from("renewal_campaigns").update({
            status: "manual_review",
            reply_text: body,
            reply_at: nowIso,
          }).eq("id", campaign.id);
        }

        return emptyTwimlResponse();
      },
    },
  },
});
