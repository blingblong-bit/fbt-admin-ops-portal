# Master Dues: read-only dry run (first pass)

## What you get
A report with exact counts and dollar totals for the proposed "Payment Due = master money list", compared side by side with today's tiles, plus a downloadable CSV:
Client | Previous Debt | Previous Status | Current Balance | Current Status | Current Expected Collection | Renewal Balance | Renewal Status | Renewal Expected Date | Total Tracked | Reason

Nothing on screen changes yet. No client records, payments, renewals, visits, messages or campaigns are touched. Texting stays off. No publishing.

## How each client is calculated
- Previous debt: existing previous-package debt rule.
- Current balance: existing current-package owed rule.
- Prepared renewal balance: renewal price minus what has already been prepaid (never below $0), included even if it starts weeks from now.
- Total tracked = the three added together. One row per client, never duplicated.
- Included: every non-archived, non-assessment, non-deleted client with a total above $0.

## Status and timing, kept separately for each money type
- Previous debt and current balance are already owed, so they are always Due now/Overdue. Square appointments never change that status.
- Current balance also gets a separate Expected Collection window from the next Square appointment: this week, next week, later, or no appointment/unknown.
- Prepared renewal status comes from the existing Square-driven package progress (visits used vs. total, plus the first uncovered appointment). The stored renewal date is not used on its own, and the Square forecast wins when the two disagree:
  - Due now/Overdue: the current package is complete and the next package has reached its start, or the first uncovered appointment is today or already past.
  - Upcoming: the current package still has visits left, and a first uncovered appointment is booked in the future. Its expected date is that appointment.
  - Prepared (no scheduled start yet): visits remain and no uncovered appointment is booked. The dollars still count, but they are never called overdue. Example: 5/8 used, $345 renewal dated Oct 2, no upcoming appointment.
  - Needs review: the amount is known, but Hub can't work out where the package ends (for example, Square's position is unreadable or there's no visit tracking).
- Needs review means a known dollar amount whose timing or meaning is unclear. A missing package price is not a known balance. It goes on a separate package-info exception list and is never counted as $0.
- Pay-per-visit or special clients with no dependable dollar amount are listed as exceptions. No amounts are made up and no new fields are added.

## Report contents
- Unique clients and total dollars; totals and client counts for each of the three money types.
- Dollars for Due now/Overdue, Upcoming, and Needs review, added up per money type (a client's whole total is never assigned to a single category). Current balances are also broken down by expected collection window. Client counts can overlap when one client has money in more than one category, and the report says so.
- Clients with more than one money type; a confirmation that each client appears once.
- Reconciliation check: the per-client totals add up exactly to previous + current + renewal, with $0 left unexplained.
- Old vs new: current Payment Due count and dollars, Renewal Scheduled non-zero count and dollars, how many clients are on both, the proposed master count and dollars, and how many clients become newly visible because their only money is a prepared renewal.

## Technical details
- New pure module `src/lib/master-dues.ts`: `computeMasterDues(clients, forecasts, weekCtx)` returns rows with per-bucket amounts, timing labels, and an expected date, plus totals. It reuses `previousOwed`, `amountOwed`, `packagePriceUnknown`, `isPayPerVisit` and the work-week helpers. Nothing imports it from the UI yet.
- Tests in `src/lib/master-dues.test.ts` cover all 11 cases listed in your brief.
- The dry run is a one-off script under /tmp that reads production clients (read-only), uses the existing renewal forecast and Square bookings to determine timing, and writes the CSV to /mnt/documents/master-dues-dry-run.csv.
- Run `bunx vitest run src/lib` and typecheck, then stop and report. UI changes (making Payment Due the master view and Renewal Scheduled workflow-only) come in a later plan once you've compared the numbers against Notes.
