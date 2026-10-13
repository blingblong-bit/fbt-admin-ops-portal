# Master Dues: read-only dry run (first pass)

## What you get
A report with exact counts and dollar totals for the proposed "Payment Due = master money list", compared side by side with today's tiles, plus a downloadable CSV:
Client | Previous Debt | Current Balance | Renewal Balance | Total Tracked | Timing/Status | Expected Payment Date | Reason

Nothing on screen changes yet. No client records, payments, renewals, visits, messages or campaigns are touched. Texting stays off. No publishing.

## How each client is calculated
- Previous debt: existing previous-package debt rule.
- Current balance: existing current-package owed rule.
- Prepared renewal balance: renewal price minus what has already been prepaid (never below $0), included even if it starts weeks from now.
- Total tracked = the three added together. One row per client, never duplicated.
- Included: every non-archived, non-assessment, non-deleted client with a total above $0.

## Timing per amount
- Previous debt: Overdue.
- Current balance: Overdue if from a prior week, Due this week if this week, Upcoming if next week, using today's existing weekly rules.
- Prepared renewal: Due this week / Upcoming based on the existing expected-start forecast (renewal start date or first uncovered appointment).
- Needs review: a known amount when Hub can't tell when it's due (for example, missing price setup or no date). The dollars stay visible.
- Pay-per-visit or special cases with no dependable dollar amount are listed separately as exceptions. No amounts are made up and no new fields are added.

## Report contents
- Unique clients and total dollars; totals and client counts for each of the three money types.
- Counts and dollars for Overdue/Due now, Due this week, Upcoming, and Needs review.
- Clients with more than one money type; a confirmation that each client appears once.
- Reconciliation check: the per-client totals add up exactly to previous + current + renewal, with $0 left unexplained.
- Old vs new: current Payment Due count and dollars, Renewal Scheduled non-zero count and dollars, how many clients are on both, the proposed master count and dollars, and how many clients become newly visible because their only money is a prepared renewal.

## Technical details
- New pure module `src/lib/master-dues.ts`: `computeMasterDues(clients, forecasts, weekCtx)` returns rows with per-bucket amounts, timing labels, and an expected date, plus totals. It reuses `previousOwed`, `amountOwed`, `packagePriceUnknown`, `isPayPerVisit` and the work-week helpers. Nothing imports it from the UI yet.
- Tests in `src/lib/master-dues.test.ts` cover all 11 cases listed in your brief.
- The dry run is a one-off script under /tmp that reads production clients (read-only), uses the existing renewal forecast and Square bookings to determine timing, and writes the CSV to /mnt/documents/master-dues-dry-run.csv.
- Run `bunx vitest run src/lib` and typecheck, then stop and report. UI changes (making Payment Due the master view and Renewal Scheduled workflow-only) come in a later plan once you've compared the numbers against Notes.
