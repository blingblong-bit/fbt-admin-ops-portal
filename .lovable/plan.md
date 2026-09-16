# Dry-run acceptance testing for dues messaging

Run the full acceptance checklist against the built workflow while sending stays off. No
real-client financial, package, consent, message or activity data changes; nothing is
published; no text leaves the system. Disposable ZZTEST records may change as the scenarios
require and are fully deleted afterwards.

## Why test records are needed

No client in the system currently has texting consent recorded (0 of 1,755 active records;
1,707 have a phone number, none have opted out). Every draft generated against real data today
would correctly come back blocked with "No recorded texting consent" — right behaviour, but it
makes the consent tests indistinguishable from everything else.

So the run uses a disposable ZZTEST cohort, with a separate record per scenario wherever states
could contaminate one another. At minimum:

- valid consent + unpaid package
- missing consent
- consent then a later opt-out
- invalid phone number
- fully paid package
- prepaid prepared renewal
- Package Info Needed
- Payment Review / unexplained overpayment
- pay-per-visit with an actual unpaid balance

Additional invalid-renewal cases (no start date, no price, no visit count) reuse one dedicated
renewal-validation record, reset between assertions. Everything is keyed by the prefix, so
cleanup stays simple.

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
- With the flag off, the send module throws
- The texting transport is instrumented during the whole run and records zero outbound calls

**No data drift**
- A before/after comparison of every client's package price, visits, amount paid, previous
  debt and prepared-renewal fields shows zero changes across the whole run
- Real-client message history and message-related timeline entries are identical before and
  after, by count and by row
- After the test records are deleted, nothing of theirs is left behind anywhere

## Test isolation — no writes to real clients

Every write-capable messaging action in this run is restricted to the disposable test records.

- Pre-Renew is pressed only on test clients.
- Generate / Refresh Preview runs under a test-only scope that limits it to the created test
  client IDs, so it cannot fan out across the 1,755 real records and create hundreds of blocked
  drafts and timeline entries.
- Real clients may be read to verify queue membership counts and blocking logic, but no draft,
  activity, consent or any other row is written for them.
- The test-only scope is removed after validation unless it turns out to be worth keeping as a
  normal operating feature.

## How it runs

1. Snapshot two baselines: all client financial/package fields, and all existing message rows
   plus message-related timeline entries (counts and IDs).
2. Create the ZZTEST cohort, one record per scenario listed above.
3. Exercise Pre-Renew, Generate/Refresh (test-scoped) and payment-before-send through the real
   app paths in a browser session, capturing screenshots of the Dues Queue, Messaging Preview
   and a client Messages tab.
4. Re-run as a staff-role account to confirm read-only visibility and blocked admin actions.
5. Run the unit suite plus added cases, and assert the send module refuses with the flag off.
6. Delete the test clients, then verify cleanup explicitly: zero remaining messages, timeline
   entries, prepared renewals or other rows referencing them.
7. Diff both baselines and report each checklist item as pass/fail with its evidence.

## Technical notes

- Scenario setup uses direct inserts of test clients (prefix `ZZTEST`) and cleanup by that
  prefix, matching how earlier validation runs were done here.
- `generateDuesPreviews` gains a temporary optional `clientIds` input; when supplied, both the
  eligibility loop and the paid-obligation closing loop are filtered to those IDs. The
  acceptance run always supplies it. It is removed after validation unless kept deliberately.
- Browser checks drive the running app at `/dues-queue`, `/messaging-preview` and
  `/clients/:id` with a real session; the staff-role pass uses a second account.
- Idempotency is asserted on `dues_messages.request_key` row counts and on the absence of
  repeat `dues_message_draft_updated` activity rows after a no-op refresh.
- Send-gate assertions call `sendDuesMessage` directly in tests: flag off throws, and
  `status = ready_not_sent` with `blocked = true` throws for being blocked. In addition the
  run mocks/instruments the outbound HTTP transport and asserts zero calls to any texting
  provider host.
- Financial baseline diff compares `package_price`, `package_total_visits`, `visits_used`,
  `amount_paid`, `previous_package_owed`, `package_start_date` and every `pending_renewal_*`
  column for all non-test clients.
- Messaging baseline diff compares `dues_messages` row IDs and count, and `client_activities`
  rows of type `dues_message_*`, before and after.
- Cleanup verification queries `dues_messages`, `client_activities` and any FK references for
  the deleted test client IDs and asserts zero rows, rather than trusting cascade.
- Any failure is reported with the failing case; fixes are proposed separately rather than
  applied silently during the test run.

## Final report format

```text
Acceptance: N/N passed
Outbound SMS calls: 0
Real-client financial changes: 0
Real-client messaging changes: 0
ZZTEST artifacts remaining: 0
Sending flag: OFF
Published: No
```


## After this run

Zero of 1,755 clients have texting consent on file. This does not block the dry run, but no
real text can ever go out until there is a legitimate way to record consent. That is the next
piece of work, handled properly rather than worked around.
