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
> Hi [First Name], this is FIT Beyond Therapy. Just a reminder that there is a remaining balance of
> $[Amount] on your current package. Reply here if you have any questions. Reply STOP to opt out.

Wording always refers to one total balance — it never mentions old-vs-current package buckets.

## Safety checks

A draft cannot be marked ready when: the phone number is missing or unusable, the client is Package
Info Needed or Payment Review, the amount due is $0 or less, a renewal message has no start date, or
the prepared renewal data is inconsistent (missing price or visit count). Blocked cases appear on the
preview page with the reason, instead of silently doing nothing.

## Messaging Preview page (admin only)

Shows every drafted message: client, message type, what triggered it, amount, package start date when
relevant, the exact text body, and any validation warnings. A "Generate / Refresh Preview" action
rebuilds drafts for the current queue. Nothing sends.

## Statuses

`ready_not_sent`, `sent`, `delivered`, `failed`, `replied`, `payment_received`. Only
`ready_not_sent` is created automatically for now.

## Technical notes

- **New table `dues_messages`**: `client_id`, `phone`, `message_type` (`renewal_due` | `balance_due`),
  `package_start_date`, `amount_due`, `body`, `status` (default `ready_not_sent`), `trigger_source`,
  `validation_warnings jsonb`, `twilio_sid`, `request_key` (unique, for future idempotent sends),
  `created_at`/`updated_at` + trigger. Staff-only RLS via `is_staff(auth.uid())` plus GRANTs for
  `authenticated` and `service_role`. Kept separate from the existing `renewal_campaigns` /
  `renewal_messages` tables, which stay untouched.
- **`src/lib/dues-messaging.ts`** (pure, fully unit-tested): `SMS_DUES_SENDING_ENABLED = false`,
  queue eligibility predicate reusing `paymentStatus` / `amountOwed` / `previousOwed` /
  `totalOwed` from `src/lib/clients.ts`, phone validation, `renderRenewalDueMessage`,
  `renderBalanceDueMessage`, and `validateDraft` returning blocking reasons.
- **`src/lib/dues-messaging.functions.ts`**: `generateDuesPreviews` (rebuild drafts for the queue),
  `listDuesMessages`, `getDuesQueue`, all `requireSupabaseAuth` + admin check. A separate
  `dues-sms.server.ts` holds the only Twilio call and throws while the flag is false; no caller
  invokes it yet.
- **`preRenewNextPackage`** in `src/lib/schedule.functions.ts` gains a post-success draft insert,
  wrapped so a draft failure never fails the renewal.
- **New routes** `src/routes/_authenticated/dues-queue.tsx` and
  `src/routes/_authenticated/messaging-preview.tsx`, both guarded with the existing `requireAdmin`,
  linked from the Admin Tools nav in `AppShell`.
- **Tests** (`src/lib/dues-messaging.test.ts`): eligibility inclusion/exclusion cases, both message
  bodies rendered exactly, each blocking validation reason, and a test asserting the flag is false
  and the send path refuses.
- No client financial values change; nothing is published.
