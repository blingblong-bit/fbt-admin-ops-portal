# Verify and repair this week’s payment updates

The read-only audit found **14 non-zero Square payments totaling $3,818.34** this week. All 14 have exactly one matching payment activity, the recorded amounts reconcile to Square, and no duplicate Square payment IDs were found.

One confirmed update failure needs correction: **Jake McGee’s $50 payment was applied, then erased from the current balance when his prepared one-visit package activated about an hour later**. The activation reset `amount_paid` to zero instead of carrying the $50 excess from the completed package into the newly activated package.

The audit also found review cases that should not be silently changed:

- **Kristin Nichols:** $345 was applied to an already fully paid $345 package, leaving $690 paid; this is correctly flagged for review.
- **Hayden Brinkley, Hayvah Eggleston, and Maddox Liles:** payments were recorded while no package price/setup exists. The money is stored, but these records need package/setup review rather than an automatic financial rewrite.
- **Randy Edwards:** pay-per-visit payments accumulate above the displayed package price by design and should not be treated as a package overpayment.

## Changes

1. **Preserve payments when a prepared package activates**
   - On prepared-renewal activation, calculate both sides of the old package:
     - unpaid remainder becomes `previous_package_owed`;
     - any paid amount above the old package price becomes starting `amount_paid` on the new package.
   - Apply the same calculation in both renewal paths so the behavior cannot differ between Schedule Check and Client Detail.
   - Record the carried payment credit in package-completion and renewal activity details for traceability.

2. **Correct the confirmed affected client**
   - Restore Jake McGee’s current-package `amount_paid` from $0 to $50, making the activated $50 single-visit package paid in full.
   - Clear only the review flag caused by that overpayment/reset sequence and add an audit activity describing the correction.
   - Do not alter Kristin, Hayden, Hayvah, Maddox, Randy, or any other client during this correction.

3. **Improve payment review detection**
   - Continue allowing the full payment amount to be recorded without a cap.
   - Keep package overpayments flagged for staff review.
   - Flag positive payments applied to package-model clients with no package price/setup, while excluding deliberate pay-per-visit clients.
   - Remove obsolete messages that still claim payments were capped at the package price.

4. **Strengthen automated checks**
   - Update the payment mock to cover `previous_package_owed` and the oldest-debt-first split.
   - Add tests for partial/full previous-debt payoff, uncapped current-package payment, duplicate protection, and prepared-package activation after a payment.

## Validation

- Reconcile every payment from this Chicago work week again after the changes: Square amount, one-time activity, previous/current split, final paid amount, owed amount, and review status.
- Confirm Jake shows $50 paid and $0 owed after correction.
- Confirm no payment, package, visit, or balance changes occurred for the other reviewed clients.
- Run the focused payment and renewal tests plus TypeScript validation.
- Do not publish automatically.

## Technical notes

- The payment database function already locks the client row, prevents duplicate application by Square payment ID, pays previous-package debt first, and sends the remainder to the current package.
- The defect is in prepared-renewal activation, which currently resets `amount_paid` to zero without preserving excess credit already received for the next package.
- Existing older payment activities may lack the newer split metadata; that is historical format, not evidence that those payments failed.
