# Activate 25 clean renewals (hold Jay Reynolds)

No texts are sent and automatic texting stays OFF. Nothing is published.

## 1. Renewal step change
Add an optional "starting visits used" value to the locked renewal step, default 0. Existing callers (Renew Package button, pre-renewal activation, webhook) behave exactly as today. It's set inside the same locked update that finishes the old package and starts the new one.

## 2. Pre-flight snapshot (read-only)
Right before the batch runs:
- Re-run the Group A preview against live data.
- Record the Master Dues total and the Renewal Scheduled count.
- Abort for any client whose state changed since the split: a new payment, a new visit number, or new pending fields.

## 3. Activate the 25
These are the 26 clean Group A clients minus Jay Reynolds: 22 fully prepaid, plus 3 unpaid at $345 (Regenia Gray, Andi Hennigan, Khloe Ewing). For each one, through the renewal step:
- New package start = the detected 1 of N date
- Visits used = the corrected Square position
- Price, visit count and name come from the prepared renewal
- Amount paid = the prepaid amount
- The old package is kept in history, and the pending fields are cleared
- No other client fields are touched

Each client runs separately, so one failure doesn't stop the others. Failures are reported.

**Expected money result:** the batch owes $1,035 before and $1,035 after (3 × $345). Those three move from renewal money to current-package money. The 22 prepaid clients end at $0 owed.

## 4. Jay Reynolds audit (read-only)
- Should the stale renewal (started 8/26) be activated first to catch the Hub up?
- Since he's already at 8 of 8 on that package, does he need another renewal prepared?
- His first uncovered appointment after the completed package.
- What Master Dues and Renewal Scheduled should show after each step.

No next renewal is created.

## 5. Post-run report
- Successes and failures
- Master Dues total and Renewal Scheduled count, before vs. after
- Each client's old → new position
- The 22 prepaid clients confirmed at $0
- The unpaid balances created by activation
- A $0 unexplained difference
- Tests and typecheck

Untouched: Group B, Abby Quick, Emma, Kristin Nichols, and the 24 manual-review clients.

## Technical details
- Migration: `CREATE OR REPLACE FUNCTION public.renew_client_package(..., p_booking_id text DEFAULT NULL, p_visits_used integer DEFAULT 0)`. Drop the old 8-arg signature in the same migration so the RPC call isn't ambiguous. The second UPDATE sets `visits_used = GREATEST(0, LEAST(p_visits_used, p_total_visits))`. The renewal activity metadata gains `visits_used_at_activation` and `source='boundary_activation'`.
- `renewClientPackage` helper: optional `visitsUsed` passes through. The server function keeps the default.
- The batch runs from a temporary /tmp script using the admin client, limited to the 25 IDs from the split. The script runs the preview check and the RPC per client, and saves a CSV in Files.
