/**
 * The ONLY module capable of sending a dues text.
 *
 * Sending is off by default and gated by the server-side environment variable
 * SMS_DUES_SENDING_ENABLED. Nothing in the app calls `sendDuesMessage` yet.
 */
import { isSendable, type DuesMessage } from "@/lib/dues-messaging";

export function smsSendingEnabled(): boolean {
  return process.env["SMS_DUES_SENDING_ENABLED"] === "true";
}

export type SendableDraft = Pick<
  DuesMessage,
  "id" | "phone" | "body" | "status" | "blocked"
>;

/**
 * Refuses unless the server flag is exactly "true" AND the draft is both
 * `ready_not_sent` and not blocked. A blocked draft (missing consent, bad
 * package data, unusable phone) can never send on its status string alone.
 */
export async function sendDuesMessage(draft: SendableDraft): Promise<{ sid: string }> {
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

  // Twilio wiring intentionally not implemented while sending is disabled.
  throw new Error("Twilio sending is not configured yet");
}
