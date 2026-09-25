# Square visit notes drive Hub visit state

## What you'll get
- The Hub works out each active client's **effective visit position** from their Square appointment notes. It uses the stored Hub count only when Square has no usable notes, and it holds when Square's numbering needs review.
- Needs Renewal, Renewal Scheduled, Payment Due weekly buckets and Dues Texts drafts all use that effective position instead of the stored Hub count.
- A small label shows where each number came from: **Square synced / Hub fallback / Review required**.
- A new admin-only **Visit Automation Review** tile and page shows what the Hub worked out from Square and what it's doing because of it.
- Stored Hub counts, check-in history, Square, payments, previous-package debt, pre-renew money, consent and Twilio stay exactly as they are.
- **Nothing is published until you've seen the impact counts.**

## How the effective state is decided
```text
Square numbered sequence (cancelled/no-show numbered visits included)
  coherent, 2+ notes  -> source Square: position = latest PAST numbered visit
  no notes / only 1   -> source Hub fallback: stored Hub count, exactly as today
  Visit Note Review issue -> source Review required: keep using Hub state, no new decisions
```
- Future appointments are only used to forecast. They never count as done.
- 8/8 in the past followed by 1/8 in the future means the current package is complete, and the next package starts on the date of that 1/8.
- Next package start: if a future 1/N note exists, use its date. Otherwise, count the remaining visits forward through upcoming appointments.

## What each area will use
- **Needs Renewal / renewal forecast:** remaining visits = total minus effective visits used. The start date comes from the Square boundary when there is one.
- **Renewal Scheduled:** existing prepared renewals stay as they are. Any mismatch with the start date Square shows gets flagged on the automation page.
- **Payment Due:** uses the effective package and renewal timing to decide which week money falls in. How payments are applied and how debt is handled don't change.
- **Dues Texts:** drafts use the effective state. Consent and sending checks don't change.

## Visit Automation Review page
Each card shows the client, the source label, the Hub count and the Square count, the effective state, recent and upcoming Square notes, the next package start, the renewal state, any money impact, and the exact action (for example "Needs Renewal", "Prepared renewal date differs from Square", "Dues week moved").
Only clients with a meaningful difference or action are listed.

## Order of work
1. Build the shared resolver and its tests (the 9 cases in your brief).
2. Add one server helper that fetches Square bookings once per request and returns every client's effective state. It uses the same 30-day chunked fetch that Visit Note Review already uses.
3. Connect it to the renewal forecast and Needs Renewal, Renewal Scheduled, Payment Due, and Dues Texts drafts.
4. Build the Visit Automation Review page, its tile and a menu link. Add source labels where the visit count already shows.
5. Run a read-only impact comparison on active clients and report: how many use Square, how many use Hub fallback, how many are held for review, how many have a different count, how many have different renewal timing, and how many have a different dues classification. Nothing is written.
6. Run the full test suite and typecheck. Stop and wait for your go-ahead before publishing.

## One thing to decide
The existing **nightly visit sweep** already **overwrites the stored Hub count** from Square notes. That breaks your "keep stored state separate" rule. I plan to switch its write step off and leave it report-only. The new effective state makes it unnecessary. Tell me if you'd rather keep it running.

## Technical details
- New `src/lib/effective-visit-state.ts` (pure): `resolveEffectiveVisitState(client, bookings, nowIso)` returns `{ source, visitsUsed, totalVisits, latestVisitBookingId, latestVisitDate, latestVisitNote, nextVisitNumber, remainingVisits, reason, upcoming[], nextPackageStart }`. It reuses `buildSequence` and `detectNoteIssues` from `square-visit-audit.ts`.
- New `src/lib/effective-visit-state.server.ts`: loads bookings with `fetchSquareBookings` (-180 to +90 days) into a map from customer to state. Server functions call it inside their handlers.
- Call sites to switch from `visits_used`: renewal forecast and Needs Renewal (`schedule.functions.ts` around lines 1760-1870), weekly payment grouping inputs, `dues-messaging.functions.ts` (line 720 and the draft builders), and `renewal.tick.ts` for the eligibility check only.
- The check-in increment path (`schedule.functions.ts` around line 744) and `apply_square_payment` stay unchanged.
- `visit-diff-sweep.ts`: remove the `visits_used` update and keep the diff logging.
- New route `/_authenticated/visit-automation-review` (admin, `requireAdmin`), server function `getVisitAutomationReview` (admin role check, read-only), dashboard tile `visit_automation_review` (staffHidden).
- Tests go in `effective-visit-state.test.ts`, plus downstream cases for Needs Renewal and dues timing.
