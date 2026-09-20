# Dues Messaging — Production Readiness (sending stays OFF)

Goal: finish lightweight consent capture, texting-service plumbing, delivery/reply tracking, and a controlled manual Send action. Real texting stays switched off until you approve a live test. No real client financial or package values change.

## 1. Verbal SMS consent

Consent is never inferred — not from a package purchase, a phone number, a booking, or a payment.

Client detail gets a "Record SMS Consent" action for staff and admins. Staff asks:

> "Can we text you about appointments, package renewals, and balances due?"

If the client says yes, staff presses Record SMS Consent. The record stores the consent time, source (`in_person_verbal`), and the staff member who recorded it, plus an activity entry. Staff can also mark a client opted out when asked verbally, storing the opt-out time and source. Nothing extra is texted to the client at consent time.

Consent is required before any draft becomes sendable. Drafts still generate without it, showing "Blocked — SMS consent not recorded".

## 2. First-message rule and later wording

The first successfully **sent** outbound message to a client carries Twilio's required footer, verbatim: "Reply STOP to unsubscribe or HELP for help."

"First message" means the first outbound message successfully submitted through this Twilio workflow — status `sent`, `delivered`, or any equivalent successful submission counts. Drafts, blocked drafts, and failed/undelivered messages do not count, so a client whose only prior attempt failed still receives the footer on the next one.

First balance message: "Hi John, this is FIT Beyond Therapy. Our records show a remaining balance of $375. Reply here if you have any questions. Reply STOP to unsubscribe or HELP for help."

First renewal message: "Hi John, this is FIT Beyond Therapy. Your next 8-visit package is scheduled to start on September 16. The amount due will be $375. Reply here if you have any questions. Reply STOP to unsubscribe or HELP for help."

Later messages drop the footer: "Hi John, this is FIT Beyond Therapy. Just a reminder that our records show a remaining balance of $375. Reply here if you have any questions." — and the renewal equivalent. Every message still identifies FIT Beyond Therapy by name. STOP and HELP keep working regardless of whether the footer is printed. Because the footer depends on send history, the body is rebuilt at send time.

## 3. Eligibility visibility

Each client shows one SMS status: Consented / Not Consented / Opted Out / Invalid or Missing Phone — on the client record and on Dues Queue cards. A small admin view lists counts per bucket with a filterable client list. A draft is sendable only when consent exists, no later opt-out exists, the phone is valid, and all existing dues validation passes.

## 4. Texting service connection (sending still off)

Connect Twilio using Lovable's supported secure server-side integration or project secrets. No Twilio credentials may be committed to source code or exposed to the browser. `src/lib/dues-sms.server.ts` remains the only application module allowed to invoke the Twilio API, and it refuses unless, checked fresh at send time: the server flag is exactly true, draft is `ready_not_sent` and not blocked, consent valid, no later opt-out, phone valid, amount still owed, and this request key has never been sent. Nothing is trusted from the stored draft.

In practice this means `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and the sending number / Messaging Service SID are stored as project secrets and read inside the server handler only.

## 5. Manual Send Now (disabled while the flag is off)

Admin/superadmin-only "Send Now" on Dues Queue and Messaging Preview. While sending is off the button is visibly disabled with the "SMS Sending Disabled" banner. When later enabled: confirmation modal showing client, phone, amount, message type and exact text; sends one message; idempotent by request key; stores the Twilio message ID, `sent_at`, status `sent`, and an activity entry. No bulk send.

## 6. Delivery status webhook

New public endpoint receiving Twilio status callbacks, verified by Twilio signature, matching the message by its Twilio ID: queued/sent → Sent, delivered → Delivered, failed/undelivered → Failed with the error detail stored. Repeated identical statuses write nothing new. Delivery callbacks never touch balances or packages.

## 7. Inbound replies, STOP and HELP

New public inbound endpoint (signature-verified) matching the sender's number to a client and storing the reply in the same message history as an inbound item. STOP / UNSUBSCRIBE / CANCEL / END / QUIT records an opt-out in the Hub, blocks all future dues sends, and logs an activity.

When Advanced Opt-Out is enabled on the Messaging Service, Twilio already sends the STOP/HELP reply and blocks that number itself — the app records the event (using the `OptOutType` field) and sends no reply of its own, so the client never gets a duplicate. Only if Advanced Opt-Out is not enabled does the app return the approved HELP response.

## 8. Conversation-style Messages tab

The existing client Messages tab is restyled as a conversation: outbound on one side, inbound on the other, with time, status, failure reason, and the amount/package context for dues drafts. Staff can read; only admin/superadmin see Send controls.

## 9. Pre-Renew and dues queue preserved

Pre-Renew keeps preparing the renewal and creating/updating its draft, never sending. Missing consent shows "Blocked — SMS consent not recorded"; recording consent and refreshing makes it sendable when everything else is valid. Dues Queue eligibility rules are unchanged; cards gain SMS eligibility alongside visit progress, balance, last status, Preview and the (disabled) Send Now. Immediately before any send, the balance is re-checked: settled → draft marked Payment Received and no send; changed amount → body regenerated and admin must confirm again.

## 10. Controlled live test (only on your go-ahead)

One dedicated test client with a phone you control, consent recorded, and a legitimate test balance. Flag turned on briefly, one message sent, delivery confirmed, reply received, STOP tested and verified to block the next send, then the flag goes back OFF. No production client is used.

## 11. Regression suite

Automated tests covering: consent recorded → sendable; no consent, later opt-out, invalid phone, Package Info Needed, Payment Review → blocked; unpaid balance eligible, fully paid not; prepaid renewal net amount; paid before send → payment_received, no send; retry sends one message only; duplicate webhook writes no duplicate activity; inbound reply stored once; STOP blocks the next send; staff read but cannot send; flag OFF → send refuses; blocked-but-ready refuses; first message includes the STOP/HELP footer and the second does not; no financial values change.

## 12. Launch state

Ships with: automatic draft generation, consent required, admin review, manual Send Now only, automatic delivery/reply tracking, no bulk send, no auto-send on Pre-Renew.

**Launch rule:** `SMS_DUES_SENDING_ENABLED` is never switched on globally during implementation. All Twilio configuration, webhook endpoints, consent controls, and the Send Now UI are built and validated with the flag OFF. The first enablement is only for the dedicated controlled test client, after explicit approval.

## Technical notes

- Existing `hasSmsConsent` / `validateDraft` consent and opt-out rules stay; the warning text becomes "Blocked — SMS consent not recorded".
- Message builders in `src/lib/dues-messaging.ts` take an `includeFooter` flag; drafts preview with the footer only when no prior outbound message for that client has status `sent`/`delivered`, and the body is rebuilt with the correct footer at send time.
- Migration: add `sms_consent_recorded_by uuid`, `sms_opt_out_source text` to `clients`; add `error_code`/`error_message` and a Twilio-SID index to `dues_messages`; allow `direction = 'inbound'` rows without a request key collision. Staff read / admin write RLS retained; consent writes go through a dedicated server function, not direct table writes.
- Server functions in `src/lib/dues-messaging.functions.ts` (record consent, mark opted out, send-now, eligibility counts) with the existing admin assertion for send.
- Webhooks as TanStack routes under `src/routes/api/public/` (`sms.status.ts`, `sms.inbound.ts`) following the existing `square.webhook.ts` pattern, with Twilio signature validation.
- `dues-sms.server.ts` calls the Twilio REST API server-side with credentials read from project secrets inside the handler; `SMS_DUES_SENDING_ENABLED` stays unset/false.
- `DUES_ACCEPTANCE_TEST_MODE` fail-closed scoping stays as-is.

## What I need from you

- Your Twilio Account SID and Auth Token, saved through the secure secrets form (never pasted in chat).
- The Twilio sending number or Messaging Service to use, and whether its Advanced Opt-Out already handles STOP/HELP.
- A phone number you control for the controlled live test.
- Note: all 1,755 clients start as Not Consented, so staff will need to record consent before anyone can be texted.
