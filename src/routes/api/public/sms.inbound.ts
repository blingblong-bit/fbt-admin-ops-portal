// Twilio inbound-SMS webhook for dues messaging.
//
// Stores the reply in the same message history as the outbound drafts, and
// records an opt-out when the client texts STOP (or when Twilio's Advanced
// Opt-Out reports one via OptOutType).
import { createFileRoute } from "@tanstack/react-router";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function twiml(body = EMPTY_TWIML) {
  return new Response(body, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function last10(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "").slice(-10);
}

const STOP_WORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "stopall"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);

export const Route = createFileRoute("/api/public/sms/inbound")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, version: "sms-inbound-v1" }),
      POST: async ({ request }) => {
        const { verifyTwilioSignature } = await import("@/lib/dues-sms.server");
        const form = await request.formData();
        const params: Record<string, string> = {};
        for (const [k, v] of form.entries()) params[k] = String(v);

        const ok = await verifyTwilioSignature(
          request.url,
          params,
          request.headers.get("x-twilio-signature"),
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });

        const from = params["From"] ?? "";
        const body = params["Body"] ?? "";
        const sid = params["MessageSid"] ?? params["SmsSid"] ?? "";
        const optOutType = params["OptOutType"] ?? "";
        const fromLast10 = last10(from);
        if (!fromLast10) return twiml();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Phone numbers are stored in mixed formats, so match on the last ten
        // digits. PostgREST caps a plain select at 1000 rows, which silently
        // hid newer clients, so page through every candidate.
        let client: { id: string; phone: string | null } | undefined;
        const PAGE = 1000;
        for (let page = 0; page < 50 && !client; page++) {
          const { data: candidates, error } = await supabaseAdmin
            .from("clients")
            .select("id, phone")
            .not("phone", "is", null)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .range(page * PAGE, page * PAGE + PAGE - 1);
          if (error) break;
          if (!candidates || candidates.length === 0) break;
          client = candidates.find((c) => last10(c.phone) === fromLast10);
          if (candidates.length < PAGE) break;
        }
        if (!client) return twiml();

        // Idempotent: one row per inbound Twilio message.
        const requestKey = `inbound:${sid || `${fromLast10}:${Date.now()}`}`;
        const { data: already } = await supabaseAdmin
          .from("dues_messages")
          .select("id")
          .eq("request_key", requestKey)
          .maybeSingle();

        if (!already) {
          await supabaseAdmin.from("dues_messages").insert({
            client_id: client.id,
            phone: from,
            message_type: "inbound_reply",
            direction: "inbound",
            amount_due: 0,
            body,
            status: "replied",
            trigger_source: "twilio_inbound",
            validation_warnings: [],
            blocked: false,
            twilio_sid: sid || null,
            request_key: requestKey,
          });
          await supabaseAdmin.from("client_activities").insert({
            client_id: client.id,
            activity_type: "dues_message_reply",
            description: "Client replied to a text message.",
            metadata: { twilio_sid: sid || null },
          });
        }

        const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
        const isStop = optOutType === "STOP" || STOP_WORDS.has(word);
        const isStart = optOutType === "START" || START_WORDS.has(word);

        if (isStop) {
          const { data: current } = await supabaseAdmin
            .from("clients")
            .select("sms_opted_out_at")
            .eq("id", client.id)
            .maybeSingle();
          if (!current?.sms_opted_out_at) {
            await supabaseAdmin
              .from("clients")
              .update({
                sms_opted_out_at: new Date().toISOString(),
                sms_opt_out_source: optOutType ? "twilio_advanced_opt_out" : "sms_reply",
              })
              .eq("id", client.id);
            await supabaseAdmin
              .from("dues_messages")
              .update({ blocked: true, validation_warnings: ["Client opted out of texts"] })
              .eq("client_id", client.id)
              .eq("status", "ready_not_sent");
            await supabaseAdmin.from("client_activities").insert({
              client_id: client.id,
              activity_type: "sms_opted_out",
              description: "Client replied STOP — opted out of text messages.",
              metadata: { source: optOutType ? "twilio_advanced_opt_out" : "sms_reply" },
            });
          }
          return twiml();
        }

        if (isStart) {
          const { data: current } = await supabaseAdmin
            .from("clients")
            .select("sms_opted_out_at")
            .eq("id", client.id)
            .maybeSingle();
          if (current?.sms_opted_out_at) {
            await supabaseAdmin
              .from("clients")
              .update({ sms_opted_out_at: null, sms_opt_out_source: null })
              .eq("id", client.id);
            // Distinct from staff-recorded consent (sms_consent_recorded), so
            // it is always clear whether the client or staff restored texting.
            await supabaseAdmin.from("client_activities").insert({
              client_id: client.id,
              activity_type: "sms_resubscribed_via_start",
              description: "Client texted START — opt-out cleared by the client (Twilio resubscribe).",
              metadata: {
                source: optOutType ? "twilio_advanced_opt_out" : "sms_reply",
                opt_out_type: optOutType || null,
                keyword: word,
                restored_by: "client",
              },
            });
          }
          return twiml();
        }

        // HELP and every other keyword: Twilio Advanced Opt-Out owns the
        // automatic replies. The Hub only records the inbound event.
        return twiml();
      },
    },
  },
});
