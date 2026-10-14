# Master Dues sorting + stale prepared-renewal activation

Nothing is published, no texts are sent, and no client records change until you approve the audit results.

## 1. Sort the Payment Due "All" view (display only)
Each client gets a rank from their highest-priority open bucket:
1. Due Now / Overdue (previous debt, current balance, started renewal, billing due now/carryover)
2. Expected This Week
3. Expected Next Week
4. Upcoming Renewals later than next week
5. Prepared, no scheduled start
6. Needs Review

Ties are broken by earliest expected date, then by name A to Z. Dollar amounts, totals and reconciliation stay exactly the same.

## 2. Emma Sazonov audit (read-only)
Pull her exact current and pending package fields, plus her Square bookings around 10/07: visit numbering, the first uncovered appointment, and any "1 of N" evidence. Then decide whether her prepared renewal should already have activated, and explain why it didn't. The cause is unconfirmed until this runs.

## 3. Impact audit across all clients (read-only)
List every non-archived client whose renewal is still pending even though Square or the effective visit state shows the new package has already begun. For each one: pending price, pending paid, start evidence, whether it's fully paid, the current incorrect state, and the expected state after activation. Emma is called out on her own. Saved as a CSV in Files.

**Stop point:** I'll report these findings before changing any records.

## 4. Activation rule (after your approval)
- A renewal activates only when there is real evidence the new package started: the first uncovered appointment has begun, or a Square "1 of N" visit for the new package. A stored date passing is never enough.
- Activation uses the existing locked renewal step. It saves the old package to history, makes the new package current, moves the prepaid money into the new package's amount paid, and clears the pending fields. A fully prepaid renewal leaves $0 owed.
- I'll run it only for clients you approve from the audit list. Turning it on automatically going forward is a separate decision for you to make.

## 5. Tests
1. Fully prepaid renewal + new package begins → activates, $0 owed
2. Partially prepaid → activates with the remaining balance
3. Unpaid → activates with the full balance
4. Stored date passed but no package start → stays prepared
5. Activation clears the pending fields
6. No double-counting in Master Dues after activation
7. An activated renewal leaves Renewal Scheduled
8. The All view sorts in the priority order above

Run the tests and typecheck, then preview signed in to confirm totals are unchanged and the order is right.

## Technical details
- Sorting: a pure `sortRows` function with a rank in `master-dues-view.ts`, used by `payment-due.tsx` for the All filter.
- Activation decision: a pure `shouldActivateRenewal(client, timing)` that needs `RenewalTiming.kind === "started"`. Execution goes through the `renew_client_package` RPC with `source: "pre_renewal_activation"`, which already carries over `pending_renewal_paid` and clears the pending fields.
