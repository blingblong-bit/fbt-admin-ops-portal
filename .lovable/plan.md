# Verify and repair this week’s payment updates

The read-only audit found **14 non-zero Square payments totaling $3,818.34** this week. All 14 have exactly one matching payment activity, the amounts reconcile to Square, and no payment was recorded twice.

One confirmed failure: **Jake McGee’s $50 payment was applied, then erased when his prepared one-visit package activated about an hour later.** Activation reset the paid amount to zero, so his prepared package now shows $50 owed even though the money was collected.

Other cases found, deliberately left for staff review rather than auto-corrected:

- **Kristin Nichols:** $345 landed on an already fully paid $345 package ($690 paid). Correctly flagged for review; no prepared renewal exists to explain it.
- **Hayden Brinkley, Hayvah Eggleston, Maddox Liles:** money recorded while no package price/setup exists. Needs package setup, not a financial rewrite.
- **Randy Edwards:** pay-per-visit, so paid above package price is normal.

## Changes

1. **Money paid ahead goes to the prepared next package — never to a general credit**

   When a payment arrives and the client has a prepared renewal:
   - pay any real balance on the currently active package first;
   - if the current package is fully paid and money remains, hold that remainder against the already-prepared next package;
   - when that prepared package activates, it starts with that amount already paid.

   If money exceeds the current package price and there is **no** prepared renewal to explain it, nothing is carried forward: it stays a **Payment Review** exception for staff. No general account credit is ever created.

2. **Fix prepared-renewal activation**
   - Unpaid remainder on the finished package still carries forward as previous-package debt.
   - Prepaid money held for the prepared package becomes the new package’s paid amount at activation.
   - Both renewal paths (Schedule Check check-in and the Client Detail renew dialog) use the same rule, done as one locked database operation so an incoming payment can’t be wiped mid-renewal or leave a half-finished renewal.

3. **Activity trail**
   - The payment records that it was received before activation and reserved for the prepared package.
   - The activation records how much prepaid money was applied, alongside any unpaid amount carried forward.

4. **Correct the confirmed client**
   - Restore Jake McGee’s activated package to $50 paid, $0 owed, and clear only the review flag caused by this reset.
   - Log an audit activity describing the correction. No other client is touched.

5. **Review flags**
   - Keep recording the full payment amount, uncapped.
   - Flag unexplained overpayment for review (no prepared renewal to absorb it).
   - Flag money applied to package clients with no package set up, excluding pay-per-visit.
   - Remove stale messages claiming payments were capped at the package price.

6. **Tests**
   - Cover previous-debt-first payment, prepaid-to-prepared-package routing, unexplained overpayment staying flagged, duplicate protection, and activation applying the prepaid amount.

## Validation

- Re-reconcile every payment from this Chicago week: amount, single application, split, final paid/owed, review status.
- Confirm Jake shows $50 paid, $0 owed.
- Confirm no changes to Kristin, Hayden, Hayvah, Maddox, Randy, or anyone else.
- Run the payment and renewal tests plus type checking. Nothing is published without your go-ahead.

## Technical notes

- Storage for prepaid renewal money: a `pending_renewal_paid` amount on `clients`, defaulted to 0 and floored at 0 by `clients_validate`; consumed and cleared at activation.
- `apply_square_payment` gains the routing step: previous debt → current package up to its price → prepared-renewal prepaid bucket (only when a prepared renewal exists) → otherwise excess stays on `amount_paid` and is flagged for review. Metadata gains `applied_to_pending_package` and `pre_activation: true`.
- Activation in `src/lib/schedule.functions.ts` and the `RenewDialog` in `src/routes/_authenticated/clients.$id.tsx` move to a single security-definer function that locks the client row, carries unpaid debt forward, sets `amount_paid` from the prepaid bucket, and writes the `package_completed`/`renewal` activities atomically.
- `detectOverpayment` in the Square webhook becomes prepared-renewal aware so legitimately prepaid clients are not flagged, while true unexplained excess still is.
