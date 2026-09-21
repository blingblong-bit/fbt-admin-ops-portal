// Twilio delivery-status callback for dues messages.
//
// Twilio POSTs application/x-www-form-urlencoded with MessageSid, MessageStatus
// and (on failure) ErrorCode / ErrorMessage. Delivery callbacks never touch
// balances or packages.
import { createFileRoute } from "@tanstack/react-router";

const EMPTY = () => new Response(null, { status: 204 });

function mapStatus(s: string): "sent" | "delivered" | "failed" | null {
  switch (s) {
    case "queued":
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
    case "undelivered":
      return "failed";
    default:
      return null;
  }
}

export const Route = createFileRoute("/api/public/sms/status")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, version: "sms-status-v1" }),
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

        const sid = params["MessageSid"] ?? params["SmsSid"];
        const status = mapStatus(params["MessageStatus"] ?? "");
        if (!sid || !status) return EMPTY;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("dues_messages")
          .select("id, client_id, status, request_key")
          .eq("twilio_sid", sid)
          .maybeSingle();
        if (!row) return EMPTY;
        if (row.status === status) return EMPTY; // repeated identical status

        await supabaseAdmin
          .from("dues_messages")
          .update({
            status,
            error_code: params["ErrorCode"] ?? null,
            error_message: params["ErrorMessage"] ?? null,
          })
          .eq("id", row.id);

        if (status === "failed") {
          await supabaseAdmin.from("client_activities").insert({
            client_id: row.client_id,
            activity_type: "dues_message_delivery_failed",
            description: "Dues text message could not be delivered.",
            metadata: {
              request_key: row.request_key,
              twilio_sid: sid,
              error_code: params["ErrorCode"] ?? null,
            },
          });
        }

        return EMPTY;
      },
    },
  },
});
