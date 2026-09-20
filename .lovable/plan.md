# Dues Messaging — Production Readiness (sending stays OFF)

Goal: finish lightweight consent capture, texting-service plumbing, delivery/reply tracking, and a controlled manual Send action. Real texting stays switched off until you approve a live test. No real client financial or package values change.

## 1. Lightweight consent capture

Consent is never inferred — not from a package purchase, a phone number, a booking, a payment, or being a long-standing client.

Client detail gets a "Record SMS Consent" action for staff and admins. It opens a confirmation modal with the exact wording staff should read:

> "Would you like to receive text messages from FIT Beyond Therapy about appointments, package renewals, amounts due, and service-related updates? Message frequency varies. Message and data rates may apply. You can reply STOP at any time."

Staff confirm the client said yes, and the record stores the consent time, source (`in_person_verbal`), and the staff member who recorded it, plus an activity entry. Staff can also mark a client opted out when told verbally, storing the opt-out time and source.

Consent is required before any draft becomes sendable. Drafts still generate without it, showing "Blocked — SMS consent not recorded".

## 2. Eligibility visibility

Each client shows one SMS status: Consented / Not Consented / Opted Out / Invalid or Missing Phone — on the client record and on Dues Queue cards. A small admin view lists counts per bucket with a filterable client list. A draft is sendable only when consent exists, no later opt-out exists, the phone is valid, and all existing dues validation passes.

## 3. Texting service connection (sending still off)

Connect Twilio using Lovable's supported secure server-side integration or project secrets. No Twilio credentials may be committed to source code or exposed to the browser. `src/lib/dues-sms.server.ts` remains the only application module allowed to invoke the Twilio API, and it refuses unless, checked fresh at send time: the server flag is exactly true, draft is `ready_not_sent` and not blocked, consent valid, no later opt-out, phone valid, amount still owed, and this request key has never been sent. Nothing is trusted from the stored draft.

In practice this means `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and the sending number / Messaging Service SID are stored as project secrets and read inside the server handler only.

## 4. Manual Send Now (disabled while the flag is off)

Admin/superadmin-only "Send Now" on Dues Queue and Messaging Preview. While sending is off the button is visibly disabled with the "SMS Sending Disabled" banner. When later enabled: confirmation modal showing client, phone, amount, message type and exact text; sends one message; idempotent by request key; stores the Twilio message ID, `sent_at`, status `sent`, and an activity entry. No bulk send.

## 5. Delivery status webhook

New public endpoint receiving Twilio status callbacks, verified by Twilio signature, matching the message by its Twilio ID: queued/sent → Sent, delivered → Delivered, failed/undelivered → Failed with the error detail stored. Repeated identical statuses write nothing new. Delivery callbacks never touch balances or packages.

## 6. Inbound replies, STOP and HELP

New public inbound endpoint (signature-verified) matching the sender's number to a client and storing the reply in the same message history as an inbound item. STOP / UNSUBSCRIBE / CANCEL / END / QUIT records an opt-out, blocks all future dues sends, and logs an activity. HELP returns the approved help reply only if the messaging service isn't already handling those keywords.

## 7. Conversation-style Messages tab

The existing client Messages tab is restyled as a conversation: outbound on one side, inbound on the other, with time, status, failure reason, and the amount/package context for dues drafts. Staff can read; only admin/superadmin see Send controls.

## 8–10. Existing behaviour preserved

Pre-Renew keeps preparing the renewal and creating/updating its draft, never sending. Missing consent shows "Blocked — SMS consent not recorded"; recording consent and refreshing makes it sendable when everything else is valid. Dues Queue eligibility rules are unchanged; cards gain SMS eligibility alongside visit progress, balance, last status, Preview and the (disabled) Send Now. Immediately before any send, the balance is re-checked: settled → draft marked Payment Received and no send; changed amount → body regenerated and admin must confirm again.

## 11. Controlled live test (only on your go-ahead)

One dedicated test client with a phone you control, consent recorded, and a legitimate test balance. Flag turned on briefly, one message sent, delivery confirmed, reply received, STOP tested and verified to block the next send, then the flag goes back OFF. No production client is used.

## 12. Regression suite

Automated tests for every rule listed in your item 12, including blocked-but-ready drafts refusing to send, retry sending only one message, duplicate webhooks not duplicating activity, staff-cannot-send, and no financial values changing.

## 13. Launch state

Ships with: automatic draft generation, consent required, admin review, manual Send Now only, automatic delivery/reply tracking, no bulk send, no auto-send on Pre-Renew.

## Technical notes

- Existing `hasSmsConsent` / `validateDraft` consent and opt-out rules stay; the warning text becomes "Blocked — SMS consent not recorded".
- Migration: add `sms_consent_recorded_by uuid`, `sms_opt_out_source text` to `clients`; add `error_code`/`error_message` and a Twilio-SID index to `dues_messages`; allow `direction = 'inbound'` rows without a request key collision. Staff read / admin write RLS retained; consent writes go through a dedicated server function, not direct table writes.
- Server functions in `src/lib/dues-messaging.functions.ts` (record consent, mark opted out, send-now, eligibility counts) with the existing admin assertion for send.
- Webhooks as TanStack routes under `src/routes/api/public/` (`sms.status.ts`, `sms.inbound.ts`) following the existing `square.webhook.ts` pattern, with Twilio signature validation.
- `dues-sms.server.ts` calls Twilio through the connector gateway; `SMS_DUES_SENDING_ENABLED` stays unset/false.
- `DUES_ACCEPTANCE_TEST_MODE` fail-closed scoping stays as-is.

## What I need from you

- Approval to open the Twilio connection card (needed before any live test).
- The Twilio sending number or Messaging Service to use, and whether its Advanced Opt-Out already handles STOP/HELP.
- A phone number you control for the controlled live test.
- Note: all 1,755 clients start as Not Consented, so staff will need to record consent before anyone can be texted.
