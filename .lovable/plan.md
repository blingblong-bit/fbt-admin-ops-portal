# Dry-run acceptance testing for dues messaging

Run the full acceptance checklist against the built workflow while sending stays off. No
client financial or package values change; nothing is published; no text leaves the system.

## One thing to decide first

No client in the system currently has texting consent recorded (0 of 1,755 active records;
1,707 have a phone number, none have opted out). That means every draft generated today will
be correctly marked blocked with "No recorded texting consent".

That is the intended safety behaviour, but it makes the consent-based tests indistinguishable
from everything else. To test properly, the run uses two disposable test clients created for
the test and deleted afterwards — one with consent, one without — instead of touching real
records. Real client data is read-only throughout.

Separately, this run will reveal whether consent needs to be captured before any real sending
phase can begin. That is a follow-up decision, not part of this plan.

## What gets verified

**Renewal drafts (Pre-Renew)**
- Pre-Renew creates exactly one renewal draft
- Pressing Pre-Renew again does not create a second one
- Changing the renewal date or price rewrites the same unsent draft (wording and amount)
- A prepared package with money already prepaid drafts only the remaining amount due

**Dues Queue membership**
- A client with a real unpaid balance appears
- A fully paid client does not
- Package Info Needed and Payment Review records are blocked
- Pay-per-visit clients appear only with an actual unpaid balance

**Blocking rules**
- Missing consent blocks
- An opt-out recorded after consent blocks
- Missing or unusable phone number blocks
- $0 or negative balance blocks
- Renewal with no start date, no price, or no visit count blocks
- A blocked draft still cannot send even though its status reads Ready — Not Sent

**Payment before sending**
- Paying the balance flips the unsent draft to Payment Received and it can never send

**Access**
- A staff (non-admin) account sees the Messages tab and history on a client
- A staff account cannot reach the Dues Queue or Messaging Preview and cannot generate
- An admin can generate and refresh, and a refresh that changes nothing adds no new draft and
  no new timeline entry

**Sending gate**
- With the flag off, the send module throws and no texting service is contacted

**No data drift**
- A before/after comparison of every client's package price, visits, amount paid, previous
  debt and prepared-renewal fields shows zero changes across the whole run

## How it runs

1. Snapshot all client financial/package fields to a comparison baseline.
2. Create the disposable test clients covering each scenario (consent, no consent, opt-out,
   bad phone, paid, unpaid, prepaid renewal, incomplete package, overpayment).
3. Exercise Pre-Renew, Generate/Refresh, and payment-before-send through the real app paths in
   a browser session, capturing screenshots of the Dues Queue, Messaging Preview and a client
   Messages tab.
4. Re-run as a staff-role account to confirm read-only visibility and blocked admin actions.
5. Run the unit suite plus added cases, and assert the send module refuses with the flag off.
6. Delete the test clients and their drafts/activities, then diff against the baseline.
7. Report each checklist item as pass/fail with the evidence behind it.

## Technical notes

- Scenario setup uses direct inserts of test clients (prefix `ZZTEST`) and cleanup by that
  prefix, matching how earlier validation runs were done here.
- Browser checks drive the running app at `/dues-queue`, `/messaging-preview` and
  `/clients/:id` with a real session; the staff-role pass uses a second account.
- Idempotency is asserted on `dues_messages.request_key` row counts and on the absence of
  repeat `dues_message_draft_updated` activity rows after a no-op refresh.
- Send-gate assertions call `sendDuesMessage` directly in tests: flag off throws, and
  `status = ready_not_sent` with `blocked = true` throws for being blocked.
- Baseline diff compares `package_price`, `package_total_visits`, `visits_used`,
  `amount_paid`, `previous_package_owed`, `package_start_date` and every
  `pending_renewal_*` column for all non-test clients.
- Any failure is reported with the failing case; fixes are proposed separately rather than
  applied silently during the test run.
