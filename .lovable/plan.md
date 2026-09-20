# Dues Messaging — Production Readiness (sending stays OFF)

Goal: finish the texting-service plumbing, delivery/reply tracking, and a controlled manual Send action. Real texting stays switched off until you approve a live test. No real client financial or package values change.

## 1. No consent step — purchase is the agreement

Per your direction, buying a package is the client's agreement to receive dues and package messages. The separate "Record SMS Consent" workflow is removed from the plan, and the existing "no recorded texting consent" blocker is dropped from draft validation.

What stays: **opt-out is always honoured.** If a client replies STOP, or staff are told verbally, the record is marked opted out and no further dues message can be sent to them. Staff get a small "Mark opted out" / "Undo opt-out" action on the client record, and each opt-out writes an activity entry.

(One note for your awareness: US carriers can still filter messages where a business can't show agreement, so every message keeps the "Reply STOP to opt out" line and we keep the opt-out record.)

## 2. Eligibility visibility

Each client shows one SMS status: Eligible / Opted Out / Invalid or Missing Phone. A small admin view lists counts for each bucket with a filterable client list. Draft validation uses exactly these fields.

## 3. Texting service connection (sending still off)

Connect Twilio through the workspace connector (no keys in code). `src/lib/dues-sms.server.ts` remains the only module that can contact Twilio and refuses unless, checked fresh at send time: the server flag is exactly true, draft is `ready_not_sent` and not blocked, the client has not opted out, phone valid, amount still owed, and this request key has never been sent. Nothing is trusted from the stored draft.

## 4. Manual Send Now (disabled while the flag is off)

Admin/superadmin-only "Send Now" on Dues Queue and Messaging Preview. While sending is off the button is visibly disabled with the "SMS Sending Disabled" banner. When later enabled: confirmation modal showing client, phone, amount, message type and exact text; sends one message; idempotent by request key; stores the Twilio message ID, `sent_at`, status `sent`, and an activity entry. No bulk send.

## 5. Delivery status webhook

New public endpoint receiving Twilio status callbacks, verified by Twilio signature, matching the message by its Twilio ID: queued/sent → Sent, delivered → Delivered, failed/undelivered → Failed with the error detail stored. Repeated identical statuses write nothing new. Delivery callbacks never touch balances or packages.

## 6. Inbound replies, STOP and HELP

New public inbound endpoint (signature-verified) matching the sender's number to a client and storing the reply in the same message history as an inbound item. STOP / UNSUBSCRIBE / CANCEL / END / QUIT records an opt-out, blocks all future dues sends, and logs an activity. HELP returns the approved help reply only if the messaging service isn't already handling those keywords.

## 7. Conversation-style Messages tab

The existing client Messages tab is restyled as a conversation: outbound on one side, inbound on the other, with time, status, failure reason, and the amount/package context for dues drafts. Staff can read; only admin/superadmin see Send controls.

## 8–10. Existing behaviour preserved

Pre-Renew keeps preparing the renewal and creating/updating its draft, never sending. Drafts are now blocked only by an opt-out, an unusable phone number, incomplete package info, payment review, or a $0 amount. Dues Queue eligibility rules are unchanged; cards gain SMS eligibility alongside visit progress, balance, last status, Preview and the (disabled) Send Now. Immediately before any send, the balance is re-checked: settled → draft marked Payment Received and no send; changed amount → body regenerated and admin must confirm again.

## 11. Controlled live test (only on your go-ahead)

One dedicated test client with a phone you control and a legitimate test balance. Flag turned on briefly, one message sent, delivery confirmed, reply received, STOP tested and verified to block the next send, then the flag goes back OFF. No production client is used.

## 12. Regression suite

Automated tests for every rule listed in your item 12, including blocked-but-ready drafts refusing to send, retry sending only one message, duplicate webhooks not duplicating activity, staff-cannot-send, and no financial values changing.

## 13. Launch state

Ships with: automatic draft generation, opt-outs honoured, admin review, manual Send Now only, automatic delivery/reply tracking, no bulk send, no auto-send on Pre-Renew.

## Technical notes

- `hasSmsConsent` is replaced by an opt-out-only check; the "No recorded texting consent" warning is removed from `validateDraft` and its tests, and the opt-out test stays.
- Migration: add `sms_opt_out_source text` to `clients`; add `error_code`/`error_message` and a Twilio-SID index to `dues_messages`; allow `direction = 'inbound'` rows without a request key collision. Existing `sms_consent_at` / `sms_consent_source` columns are left in place, unused.
- Server functions in `src/lib/dues-messaging.functions.ts` (opt-out / undo opt-out, send-now, eligibility counts) with the existing admin assertion for send.
- Webhooks as TanStack routes under `src/routes/api/public/` (`sms.status.ts`, `sms.inbound.ts`) following the existing `square.webhook.ts` pattern, with Twilio signature validation.
- `dues-sms.server.ts` calls Twilio through the connector gateway; `SMS_DUES_SENDING_ENABLED` stays unset/false.
- `DUES_ACCEPTANCE_TEST_MODE` fail-closed scoping stays as-is.

## What I need from you

- Approval to open the Twilio connection card (needed before any live test).
- The Twilio sending number or Messaging Service to use, and whether its Advanced Opt-Out already handles STOP/HELP.
- A phone number you control for the controlled live test.
- Confirmation that all current clients should be treated as eligible (no consent gate), with only opt-outs excluded.
