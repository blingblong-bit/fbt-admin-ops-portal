# Admin workflow improvements (approved scope with your safeguards)

These rules don't change: financial corrections are admin-only, every money change is saved in one step or not at all, no existing client money records are changed, the Payment Due and Weekly Dues calculations stay the same, and no texts, Square changes or publishing.

## Readiness findings (baseline)
- **Yes:** edit package fields, edits flow through to Payment Due and Weekly Dues.
- **Partial:** renewing a package, manual payments, prepared renewal edits, history.
- **No:** moving a payment between packages, changing billing type.
- The renewal-timing fix is already in the code that would be published.

## What gets built
1. **Manual payment method and notes.** Record Payment gets a required method (Venmo, cash, check, other) and a note, plus an optional Square payment ID.
   - If that Square payment ID is already recorded for any client, it is **blocked**.
   - If the same client has a payment for the same amount within 3 days, a **warning** asks the admin to confirm. It never blocks on its own.
2. **Move a payment between packages.** On the client page, each payment shows where its money went: previous package, current package, or prepared renewal. An admin picks one payment and moves part of it to another bucket.
   - The payment ID and total received never change.
   - It can't move more than that payment put into a bucket, and no bucket can go below $0.
   - Every move is saved as a new step in that payment's history, with who did it, when, and why.
   - Payments from before allocation was recorded show as **Needs Review**, and moving them is blocked.
3. **Prepaid amount on a prepared renewal.** Editing the prepaid amount is done through the same move action, so money is never created from nothing. Editing a prepared renewal's dates, size and price stays in the existing Edit form.
4. **Billing type, rate and start date.** An admin-only section with package, pay-per-visit, weekly or assessment (assessment only where the app already supports it). It warns that the package fields stop counting toward money owed for pay-per-visit and weekly clients.
5. **Before and after history.** Edit Client and every new action save which fields changed, from what, and to what. The Activity list shows them.
6. **Renew-twice protection.** Each renewal is tied to the package it ends: its start date, size and the Square visit that started the new one.
   - Renewing the same package boundary twice is blocked, however much time has passed.
   - A separate admin-only **Undo renewal** puts the client back exactly as they were before (from the saved history) and records why. It's only offered for the most recent renewal, and only if no payments or visits landed afterward. Otherwise it shows Needs Review.
7. **Tests:**
   - moves keep each payment's total the same and never go negative
   - an older payment with no recorded split can't be moved
   - a repeated Square ID is blocked, and a same-amount payment within 3 days only warns
   - renewing the same boundary twice is blocked, and Undo restores the earlier state exactly
   - only admins can make these changes
   - billing-type save works
   - Then the full test suite and code check.
   - End-to-end in the browser with **temporary test clients only**, removed afterward.
8. Update the roadmap and project notes, then give you an updated GO / NO-GO.

## Technical details
- Migration (additive only):
  - New table `payment_allocations` (`id`, `client_id`, `payment_ref`, `bucket` prev/current/pending, `amount`, `reason`, `actor`, `created_at`). It is append-only, with grants and admin-only RLS.
  - New nullable columns `square_payments.method`, `square_payments.manual_note`, and `clients.last_renewal_key`.
- New security-definer functions. Each checks the admin role, locks the client row and validates input:
  - `reallocate_payment(client, payment_ref, from, to, amount, reason)` adjusts `previous_package_owed` / `amount_paid` / `pending_renewal_paid` by the same amount in opposite directions and inserts allocation rows. It rejects payments whose allocation is unknown. Older allocations come from the existing payment activity metadata (`applied_to_*`). Where that is missing, the payment is marked Needs Review.
  - `undo_last_renewal(client, reason)` restores from the `package_completed` and `renewal` activity metadata.
  - `update_billing(client, type, rate, effective_date)`.
- `renew_client_package` gets a boundary key check. The parameter stays optional, so existing callers keep working. `apply_square_payment` stays the only path that records payments; the manual path passes its method and note.
- Edit Client moves to a server function that diffs old and new values into the activity metadata.
- No changes to `master-dues.ts`, `weekly-dues.ts` or `billing-sim.ts`.
