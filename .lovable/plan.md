# Fix: prepared renewal tied to the wrong package start (Melani case)

Nothing in client records changes. No texts and no publishing. The work stops after the simulation and the previews.

## The bug
When a client has a prepared renewal, the system checks whether Square shows a new package already began (a 1/N after an N/N). If that start is later than the package start date stored in Hub, it marks the renewal Due Now.

Melani's stored start (8/14) is out of date. The 8/28 start Square shows is the package she is in now (at 6/8), not her renewal. Her renewal really starts at the first visit her current package doesn't cover: 11/6.

## New rule
A past Square package start counts as the prepared renewal's start only if all of these are true:
1. That package is still in progress (unchanged from the Jay fix).
2. It began after the renewal was prepared. A renewal can't start before it existed.
3. If the preparation time isn't recorded, Square must also show the package Hub tracks was finished (an N/N on or after Hub's start date and before the new 1/N). This keeps Emma-type cases working.

Otherwise the renewal timing comes from the first appointment the current Square package doesn't cover, counting only live visits. It never uses any future 1/N or a cancelled one. If the boundary is unclear, timing becomes Needs Review instead of guessing.

## Tests to add
- **Melani:** 8/28 start was before the renewal was prepared. Shows Upcoming 11/6, not Due Now.
- **David:** finished 8/8, the 10/15 cancelled 2/8 is ignored. Shows Upcoming 10/27.
- **Jay:** stays Upcoming 10/28, then Due Now after that visit.
- **Emma-type:** 1/N after the renewal was prepared and after the Hub package finished. Shows Due Now.
- **Cancelled or replaced 1/N:** never starts a renewal.
- **Preparation time missing:** falls back to rule 3.

## Before/after simulation (read-only, all 309 clients)
- Run the current logic and the new logic on the same Square data.
- List every client whose amount owed, renewal timing, or category changes, with the reason for each.
- Report totals before and after and confirm the unexplained difference is $0.
- Expected change: Melani's $345 moves from Due Now to Upcoming (week of Nov 2). Any other change is listed and explained. If any change can't be explained, the code change is held back.

## Incomplete clients: 30 vs 29
All 30 incomplete clients are accounted for. 29 have no findings and are marked "Not cleared (incomplete data)". The 30th is Priya Patel: her Square data is also incomplete, but she has findings (a $375 payment needing review, and a visit before her first numbered visit). So she is listed under those findings and not counted as cleared. The new spreadsheet adds a column for this so both counts match exactly.

## Correction previews (read-only, nothing applied)
These are the plan. Exact before/after numbers will come from the same calculation.

**Emma Sazonov** (owes $0 now and after; only her package history changes)
- **Now:** "8 Sessions" package starting 9/4, Hub 4/8, $375 of $375 paid. Both payments are on it: 9/08 and 10/05, $375 each. No prepared renewal. Square shows 5–8/8 from 9/21 to 10/01, then a new package from 10/07 (1/8), now at 4/8.
- **Preview:**
  1. Finish the 9/4 package at 8/8, paid by the 9/08 payment, $0 left.
  2. Start a new $375 8-visit package on 10/07, paid by the 10/05 payment, visits 4/8.
- **Payment Due:** $0 before and after.

**David Butner** (the $345 renewal moves from unpaid to prepaid)
- **Now:** $345 8-visit package starting 9/08. Hub shows 6/8 but Square shows 8/8 (8/8 on 10/01). $690 paid. Prepared renewal $345 with $0 prepaid; stored date 10/13, but Square's real start is 10/27 (1/8).
- **Square payments:** $345 each on 7/7, 8/11, 9/8 and 10/1. The 10/1 payment came in before the renewal was prepared, so it stayed on the current package as an overpayment.
- **Preview:**
  1. Current package becomes $345 of $345 paid, at 8/8.
  2. Renewal gets $345 prepaid and its date is corrected to 10/27.
- **Payment Due:** $345 (renewal, week of 10/26) before, $0 after.
- The 10/01 payment is flagged for review, so it is confirmed against Square before any move.

## Deliverables
- The code change and tests.
- `renewal-timing-fix-simulation_v1.csv` (every changed client).
- `integrity-audit_v2.csv` (with the incomplete-data column).
- `correction-previews_v1.csv` (Emma and David).
- Tests and type check. Then stop.

## Technical notes
- Change goes in `renewalTimingFor` in `src/lib/master-dues.ts`. It gets the client's `pending_renewal_created_at` and Hub `package_start_date`. `drivingCounts` / the visit-position logic also need to report whether an N/N fell between Hub's start date and the boundary.
- `getMasterDues` passes the extra fields through. No changes to the database or to how payments are applied.
- Tests go in `src/lib/package-boundary.test.ts`.
