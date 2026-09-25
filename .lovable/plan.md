# Final read-only acceptance test: Square visits → renewals → Payment Due → Dues Texts

## What you'll get
A single acceptance report covering all 16 scenarios in your brief, plus reconciliation checks and a safety proof. Nothing is sent, created or changed. Texting switches stay OFF. I stop after the report, before publishing.

## How it runs
1. **Scripted scenarios (automated tests).** Each of the 16 cases becomes a dry-run scenario built from made-up Square appointments and client balances. It runs through the real chain the Hub uses: visit position, renewal timing, Payment Due week, dues draft, and the last-visit renewal text. These are in-memory only.
2. **Real-client spot check (read-only).** Where a safe existing client matches a case (for example Analeigh Spain for a cancelled numbered visit, a Square synced client with a stale Hub count, a Hub fallback client, a Review required client), the same chain runs against live data with no writes. It only uses clients you've approved for read-only audits, and never touches Briley Taylor or Nick Smith.
3. **Safety proof.** Row counts for clients, payments, renewals (activities), dues messages and renewal campaigns are taken before and after. The report also confirms 0 messages sent, 0 campaigns touched, 0 data written, and both texting switches OFF.

## Per-case output
Visit source, visit position, next package start, current / previous / next-package amount due, Payment Due week, Needs Renewal, Renewal Scheduled, dues draft yes/no, last-visit text yes/no, and **pass/fail** against your expected result.

## Reconciliation checks
- No client appears twice in the same money bucket
- Current + next-package totals add up to the combined total
- Moving a prepared renewal into active status changes only which bucket it appears in, not the combined total
- A payment made before send closes the dues obligation
- No Review required client gets a new automated money or text decision

## If a case fails
I report it with the exact reason and a proposed fix, but I don't change any logic this turn unless it's a clear bug in the test itself. Fixes wait for your go-ahead.

## Technical details
- New `src/lib/acceptance-chain.test.ts`. A small pure helper chains `resolveEffectiveVisitState` → `drivingCounts` → `forecastRenewal` → week bucketing (same Chicago week logic as `getRenewalForecast`) → `groupWeeklyPayments` → dues draft classification (`dues-messaging.ts`) → `decideRenewalText`. Money routing is checked through `routePayment` / `computeRenewalTransition`. Package Info Needed and Payment Review are checked as excluded.
- If week bucketing is only inline in `schedule.functions.ts`, it is pulled into a pure exported function without changing its behaviour, so the tests exercise the real code.
- Live spot check: a temporary admin-guarded read-only endpoint, deleted right after use. `select count(*)` before and after on `clients`, `square_payments`, `client_activities`, `dues_messages`, `renewal_campaigns`, `renewal_messages`. Checks that `SMS_DUES_SENDING_ENABLED` and `RENEWAL_AUTO_TEXT_ENABLED` are not "true".
- Afterwards: full vitest suite and typecheck.
