# Dues messaging workflow (texts drafted, nothing sent)

Build the full "money owed" texting workflow with sending switched off. Every action writes a
drafted message you can read on screen; no text can leave the system until the switch is flipped.

## The off switch

A single server-side flag, `SMS_DUES_SENDING_ENABLED`, defaults to **false**.

While it is false:
- no texting service is ever called — the send path is isolated in its own file and refuses to run
- messaging actions only create and store draft messages
- every messaging screen shows a clear "SMS Sending Disabled — drafts only" banner

## Where drafts get created

**1. Pre-Renew button (Needs Renewal)**

All existing renewal behavior stays exactly as it is. After a successful pre-renewal, a draft is
also stored with: client, phone, message type `renewal_due`, package start date, amount due,
the message body, status `ready_not_sent`, and created time.

Body:
> Hi [First Name], this is FIT Beyond Therapy. Your next [X]-visit package is scheduled to start on
> [Date]. The amount due will be $[Amount]. Reply here if you have any questions. Reply STOP to opt out.

**2. New "Send Dues Message" queue (admin-only page)**

Lists package clients with a real unpaid balance — current package owed above $0, or previous
package debt above $0.

Excluded: Package Info Needed, Payment Review, records dismissed as "no package needed", anyone at
$0 real balance, and pay-per-visit clients unless they actually owe for visits.

Each card shows: name, visit progress, package name, current package owed, previous package owed,
total owed, last message status, and a Preview button.

Body:
> Hi [First Name], this is FIT Beyond Therapy. Just a reminder that our records show a remaining
> balance of $[Amount]. Reply here if you have any questions. Reply STOP to opt out.

Wording always refers to one total balance — it never mentions old-vs-current package buckets.

Renewal messages use the amount actually still due on the prepared package (its price minus anything
already prepaid), not the full package price.

## Safety checks

A draft cannot be marked ready when: the phone number is missing or unusable, no recorded texting
consent exists for the client, the client is Package Info Needed or Payment Review, the amount due is
$0 or less, a renewal message has no start date, or the prepared renewal data is inconsistent
(missing price or visit count). Blocked cases still appear on the preview page with the reason shown
in red, instead of silently doing nothing.

## Drafts stay in sync — no duplicates

Pressing Pre-Renew again, or hitting Generate / Refresh Preview repeatedly, updates the existing
unsent draft for that obligation rather than creating another one. If the renewal date or price
changes, the unsent draft's wording and amount are rebuilt from current records. If the balance gets
paid before anything is sent, the unsent draft is marked Payment Received and can never be sent.

## Messaging Preview page (admin only)

Shows every drafted message: client, message type, what triggered it, amount, package start date when
relevant, the exact text body, and any validation warnings. A "Generate / Refresh Preview" action
rebuilds drafts for the current queue. Nothing sends.

## Statuses

`ready_not_sent`, `sent`, `delivered`, `failed`, `replied`, `payment_received`. Only
`ready_not_sent` is created automatically for now.

## Client detail — Messages

A new Messages tab on each client page lists that client's dues messages, newest first: date and
time, type (renewal or balance), the exact wording, the amount referenced, package start date where
relevant, what triggered it, status, delivery ID once sending is on, and any blocking warnings.
While sending is off, each one is clearly labeled "Draft — Not Sent" so nobody mistakes it for a real
text to the client.

Above it, a small summary line: last dues message and its status, last renewal message and its
status, and whether the client has replied. Clicking it opens the Messages tab.

The timeline is built so future incoming replies and staff replies drop into the same list and read
as a conversation. No live sending or inbound texting is built now.

Message events also write short entries into the normal client activity timeline: draft created,
sent, delivery failed, client replied, payment received after a dues message. Full wording stays in
the Messages tab only.

## Technical notes

- **New table `dues_messages`**: `client_id`, `phone`, `message_type` (`renewal_due` | `balance_due`),
  `direction` (`outbound` default, `inbound` reserved for future replies), `package_start_date`,
  `amount_due`, `body`, `status` (default `ready_not_sent`), `trigger_source`,
  `validation_warnings jsonb`, `blocked boolean`, `twilio_sid`, `request_key` (unique; encodes the
  obligation, e.g. `renewal:<client>:<start>:<price>` / `balance:<client>:<package_start>`),
  `sent_at`, `created_at`/`updated_at` + trigger. Staff-only RLS via `is_staff(auth.uid())` plus
  GRANTs for `authenticated` and `service_role`. Existing `renewal_campaigns` / `renewal_messages`
  tables stay untouched, and client history reads `dues_messages` directly — no duplicate store.
- **Consent columns on `clients`**: `sms_consent_at timestamptz`, `sms_consent_source text`. Missing
  consent is a blocking validation warning; drafts still generate in preview mode.
- **`src/lib/dues-messaging.ts`** (pure, fully unit-tested): queue eligibility reusing
  `paymentStatus` / `amountOwed` / `previousOwed` / `totalOwed` from `src/lib/clients.ts`, phone
  validation, consent check, `renderRenewalDueMessage`, `renderBalanceDueMessage`, `duesRequestKey`,
  and `validateDraft` returning blocking reasons.
- **`src/lib/dues-sms.server.ts`**: the only module able to call Twilio. It reads
  `process.env.SMS_DUES_SENDING_ENABLED` inside the function and throws unless it is exactly `true`;
  no caller invokes it yet. Client-side code reads a non-secret `sendingEnabled` value returned by a
  server fn purely to render the banner.
- **`src/lib/dues-messaging.functions.ts`**: `generateDuesPreviews` (upsert-by-`request_key` rebuild
  of unsent drafts, including marking paid obligations `payment_received`), `getDuesQueue`,
  `listDuesMessages({ clientId? })`, `getMessagingFlag`; all `requireSupabaseAuth` + admin check.
- **`preRenewNextPackage`** in `src/lib/schedule.functions.ts` gains a post-success draft upsert,
  wrapped so a draft failure never fails the renewal.
- **New routes** `src/routes/_authenticated/dues-queue.tsx` and
  `src/routes/_authenticated/messaging-preview.tsx`, both guarded with the existing `requireAdmin`,
  linked from the Admin Tools nav in `AppShell`; Messages section added to
  `src/routes/_authenticated/clients.$id.tsx`.
- **Tests** (`src/lib/dues-messaging.test.ts`): eligibility inclusion/exclusion, both message bodies
  rendered exactly, each blocking reason including missing consent, renewal amount net of prepaid,
  stable `request_key` across repeat generation, paid-before-send transition, and a test asserting
  the send module refuses while the flag is off.
- No client financial values change; nothing is published.
