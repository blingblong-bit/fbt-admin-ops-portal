# Full Renewal & Payment Integrity Audit (read-only)

Nothing is changed: no client records, payments, package history, calculation rules, texts, or publishing. The work stops once the report is delivered.

## What gets audited
Every client that isn't archived or deleted (not only the ones on Payment Due), including $0 balances, finished packages, prepared renewals, and clients missing package info. For each client, the audit pulls their Square bookings and visit numbers, payments (Square and manual), Hub package fields, the shared visit-position logic, and Master Dues.

## Checks (one audit script, run against live data, read-only)
- **A. Missing renewals:** Square shows a new package starting (N/N, then 1/N) but Hub has no new package and no prepared renewal. Report the start date, visit count, any payments that could cover it, and what Hub is missing. No price is assumed.
- **B. Renewal date passed but not activated:** sort each case into one of four groups: wrong or old stored date; old package finished with the next visit still in the future; new package really started (should be active); prepaid but not active. Includes a full trace for David Butner covering his $690 paid, Oct 13 vs Oct 27, and where the second $345 is sitting.
- **C. Wrong renewal detection:** the renewal is tied to an old start, an 8/8 visit, a cancelled or replaced visit, or a past date instead of the next uncovered visit. The current boundary logic stays as it is unless a real defect shows up.
- **D. Payment allocation:** paid more than the package price with no clear target; payments made before the renewal was prepared; the same payment recorded twice (manual and Square); money sitting on the old package that belongs to the new one. Checked against the existing order (previous debt, then current, then prepared renewal). No payments are moved.
- **E. Billing type:** assessment-only clients being charged; per-visit or weekly clients set up as packages; a single visit followed by numbered visits; missing prices or visit counts that don't match. A "1 of 8" note alone never creates a $375 debt. These cases are flagged for review.
- **Named clients checked one by one:** David Butner, Katie Farrier, Emma Sazonov, Zach Wolberg, Melani McKamey (actual start Nov 6), Regenia Gray, Jay Reynolds (Oct 28), Nick Smith, Tammie Cox, Jan Logan, Ava Catherine Banks, Grayson Hill, Elizabeth Banks, Keri Evans. Clients that were already fixed are checked against their current records and reported as resolved.

## Report
- Each flagged client gets: name and profile link, Hub package and renewal state, Square visit evidence, payment dates and amounts, Master Dues balance, the exact reason, the proposed fix, confidence (High / Medium / Needs Human Confirmation), and what it affects (collectible dues, future renewals, or package history only).
- Six groups: confirmed system bugs, missing package records, payment allocation, billing classification, human review, and resolved. Includes the number of clients audited and the count in each group.
- Effect on Master Dues and Weekly Dues: balance missing, false balance, wrong week, prepaid counted as unpaid, or client left out. Possible dollar impact is kept separate from amounts confirmed as collectible.
- Root causes: for each confirmed bug, which part of the logic causes it and the smallest safe fix, plus suggested tests to guard against it. Nothing gets built yet.
- Deliverables: `/mnt/documents/integrity-audit_v1.csv` (one row per client) and a summary in chat.

## Validation
Run the existing tests and type check, then stop.

## Technical notes
- A temporary script under /tmp reuses `loadSquareBookingIndex`, `effectiveStateFor`, `drivingCounts`, `renewalTimingFor`, `computeMasterDues`, and `simulateBilling`, with read-only queries on clients, square_payments, and client_activities.
- Duplicate payments are detected by matching amount and date within 1 day across Square payment IDs and manual payment activity entries.
