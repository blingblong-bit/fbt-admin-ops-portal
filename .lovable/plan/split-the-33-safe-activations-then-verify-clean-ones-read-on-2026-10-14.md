# Split the 33 "safe" activations, then verify clean ones (read-only)

The package-boundary fix is approved. No client records change in this step, and nothing is published or texted.

## 1. Reclassify the 33 Safe Activation clients
- **A. Clean activation:** the boundary is clear, prepaid is no more than the renewal price, there's no duplicate, manual or carry-forward payment pattern, and the activation preview keeps the financial state exactly the same.
- **B. Activation with payment anomaly:** the boundary is clear, but either prepaid is more than the renewal price, or the payment history shows duplicates, same-amount manual entries, money carried forward, or unclear allocation.
  - Leann Uselton ($750 prepaid on a $375 renewal) and Danielle Daigle ($200 on $100) are known B cases. Others are found by rule.

These stay where they are: Emma in Activation + payment move, Kristin Nichols in Manual review, and the 24 clients with no prepared renewal in Manual review.

## 2. Group B report
For each B client: renewal price, prepaid amount, excess, the payment rows behind the prepaid amount, and what activation would do with the excess under the current renewal step. That step puts the full prepaid amount on the new package as amount paid, so any excess shows up as a reviewable overpayment on the new package. It never becomes credit. Group B is not activated.

## 3. Verify each Group A client before any batch change
Each client is simulated without being saved, and must pass all of these:
- The old package is recorded in history (a "package completed" entry with its price, paid and visits).
- The new package starts on the detected 1 of N date.
- Visits used equals the corrected Square position.
- Amount paid on the new package equals the old prepaid amount.
- All pending renewal fields are cleared.
- Master Dues for that client is the same before and after.

**Known gap:** today's renewal step resets visits used to 0 and uses whatever start date it's given. A clean activation therefore needs two things: the detected 1 of N date passed in as the start date, and visits used set to the corrected position in the same locked operation. I'll propose that as a small, additive change to the renewal step: an optional starting visits-used value, defaulting to 0 so today's behavior is unchanged. It will be tested before any batch run.

Result: the exact count of genuinely clean activations, plus any that failed a check and why, saved as a CSV in Files.

## 4. Emma
Kept separate. The recommended fix, which needs your approval later: move the 10/06 $375 payment (`bdW7y4TNJcVNZAXdEJiCrhaffkDZY`) to her 10/07 package as prepaid, then activate. She ends at $0 owed, with no temporary debt.

## Technical details
- Temporary audit script under /tmp that reuses `effective-visit-state` and `computeMasterDues`. The pure activation preview mirrors `renew_client_package`. Only reads.
- Anomaly rules for B: prepaid > price; two payment entries of the same amount within 3 days (Square plus manual); a manual entry inside the package window; or ledger pending-applied total ≠ stored pending_renewal_paid.
- Proposed RPC addition (not applied yet): an optional `p_visits_used integer DEFAULT 0` on `renew_client_package`, set inside the same locked update.

## Additions (approved)
- A client counts as clean only when the preview passes all six checks in step 3 together.
- Report before any migration: exact A and B counts, every client moved from A to B and why, every A client that fails the preview and why, the B anomaly details, and confirmation that every clean A preview keeps dollars exactly the same.
- Added test: a preview with visits used set to 3 produces the new package at 3/N (not 0/N) and leaves the money totals unchanged.
- Run the audit, tests and typecheck, then stop and report. No client, renewal-step or database changes yet.
