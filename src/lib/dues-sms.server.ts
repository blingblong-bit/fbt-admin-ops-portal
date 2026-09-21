/**
 * The ONLY module capable of sending a dues text.
 *
 * Sending is off by default and gated by the server-side environment variable
 * SMS_DUES_SENDING_ENABLED. Credentials are read from project secrets inside
 * the handler and never leave this module.
 */
import { isSendable, type DuesMessage } from "@/lib/dues-messaging";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function smsSendingEnabled(): boolean {
  return process.env["SMS_DUES_SENDING_ENABLED"] === "true";
}

export type SendableDraft = Pick<
  DuesMessage,
  "id" | "phone" | "body" | "status" | "blocked"
>;

export type SendResult = { sid: string; status: string };

/**
 * Refuses unless the server flag is exactly "true" AND the draft is both
 * `ready_not_sent` and not blocked. A blocked draft (missing consent, bad
 * package data, unusable phone) can never send on its status string alone.
 *
 * Money/eligibility re-validation happens in the calling server function,
 * which re-reads the client fresh from the database.
 */
export async function sendDuesMessage(draft: SendableDraft): Promise<SendResult> {
  if (!smsSendingEnabled()) {
    throw new Error("SMS sending is disabled (SMS_DUES_SENDING_ENABLED is not true)");
  }
  if (!isSendable(draft)) {
    throw new Error(
      draft.blocked
        ? "Draft is blocked by validation and cannot be sent"
        : `Draft status "${draft.status}" is not sendable`,
    );
  }
  if (!draft.phone) throw new Error("Draft has no phone number");

  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const messagingServiceSid = process.env["TWILIO_MESSAGING_SERVICE_SID"];
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials are not configured");
  }
  if (!messagingServiceSid) {
    throw new Error("TWILIO_MESSAGING_SERVICE_SID is not configured");
  }

  const params = new URLSearchParams({
    To: draft.phone,
    Body: draft.body,
    MessagingServiceSid: messagingServiceSid,
  });
  const statusCallback = process.env["SMS_STATUS_CALLBACK_URL"];
  if (statusCallback) params.set("StatusCallback", statusCallback);

  const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[dues-sms] Twilio request failed [${res.status}]: ${errorBody}`);
    throw new Error(`Twilio request failed [${res.status}]: ${errorBody}`);
  }

  const json = (await res.json()) as { sid?: string; status?: string };
  if (!json.sid) throw new Error("Twilio returned no message SID");
  return { sid: json.sid, status: json.status ?? "queued" };
}

/**
 * Validates an inbound Twilio webhook signature (X-Twilio-Signature).
 * Returns false when the auth token is missing, so unverified callers are
 * always rejected.
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  if (!authToken || !signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
