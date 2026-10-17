# Emma / David verification and correction prep (no writes until final approval)

## Read-only findings already confirmed

**Emma Sazonov** (linked Square record)
- Current Hub: "8 Sessions", $375, start 9/4, 4/8 used, paid $375, no previous debt, no prepared renewal.
- Two distinct COMPLETED Square payments, each logged once: `L7zg…YhQZY` $375 (9/08) and `bdW7…DkZY` $375 (10/06, flagged for review). Both were applied to the "current package" at the time.
- Correction will not create or delete any payment rows or payment activities. Both IDs stay attached to her, so a payment retry stays idempotent and can't double-count.

**David Butner** (linked record `67340893…`)
- 10/01 payment `JmbT…HEZY`: $345, COMPLETED in the stored record, unique ID, logged once.
- It was applied entirely to the current 9/08 package (prior $0, pending $0). That makes current paid $690 against a $345 price, so it is a $345 overpayment on the current package. It is not applied to any other debt or package.
- The 7/07, 8/11, and 9/08 $345 payments each match one earlier package. There is no sign of a duplicate.
- **New concern:** there is a second, unlinked "David Butner" record (`a0d0d064…`, 6/02 package, $0 paid). It is not archived. There is also a second unlinked "Melani McKamey" record (`fcdf41f0…`, fully paid). Before any money moves, check whether Payment Due counts the extra David record as $345 owed.

## Steps on approval (all read-only)

1. **Check David's payment live in Square.** Fetch `JmbT…HEZY` directly from Square. Confirm its status is COMPLETED, the amount is $345, it has no refund, it's the right customer, and the receipt is different from the 9/08 payment. Report any mismatch and stop there.
2. **Check the extra David record.** Show whether Master Dues counts it, and what it would contribute. Only recommend archiving it; don't do it.
3. **Check Melani on screen.** Open Payment Due as an admin in the preview. Screenshot Melani's row and confirm it shows $345, Upcoming, Nov 6, and not under Due Now.
4. **Exact write previews.** Return field-by-field before/after values and Master Dues before/after:
   - Emma: add a closing note for the 9/4 package at 8/8, tied to the 9/08 payment. Set the current package start to 10/07 with 4/8 used and $375 paid, tied to the 10/05–10/06 payment. Clear the review flag on `bdW7…`. Expected balance: $0 → $0.
   - David: move $345 from current paid ($690 → $345) to prepared-renewal paid ($0 → $345), tied to `JmbT…HEZY`. Clear the review flag. Expected balance: $345 → $0.
5. **Safety checks shown with the preview:** payment row counts stay the same, payment activity counts stay the same, all package history entries are kept, and only new correction notes are added.

## Final write (only after you approve the previews)
- One transaction per client: update the fields, add a correction note that lists both payment IDs, then read the record back.
- No publishing, no texts, no Square changes.
