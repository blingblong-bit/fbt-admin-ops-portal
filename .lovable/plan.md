# Prepared renewal: stored start date vs Square timing (findings + remaining read-only steps)

Nothing is changed and nothing is published. This plan only lists what the investigation found and what still needs to run.

## Findings so far (confirmed by reading the code)
- **The stored "New package starts" date** is an earliest-eligible date entered by an admin. When the renewal was prepared, it was prefilled from the next Square appointment, and staff could edit it. It is not an imported date and not the date the renewal actually started.
- **Payment Due, Weekly Dues and dashboard tiles** take renewal timing from Square progress only. The stored date does not decide the week or the amount.
- **Square payment webhook:** the stored date only checks whether a renewal exists, to explain an overpayment. Money is routed by `apply_square_payment`, not by date. No issue.
- **Dues texts:** the stored date only shows in the draft text and as a check that a date exists. It never triggers a send, and sending stays off. This is a display issue only: the text could show the stored date instead of Square's date.
- **Check-in activation: a real gap was found.** At check-in, the prepared package activates when the visit is on or after the stored date and either:
  - Square shows the visit as 1/N, **or**
  - Square has no visit number for that booking, **or the Square lookup fails or times out**.

  It does **not** check whether the current package still has visits left. So for Lisa Myers (3/8 used, stored 10/14), an unnumbered visit, or a failed Square lookup, on or after 10/14 would switch her to the new package early. Then, in one step, it would carry her unpaid balance forward as previous-package debt.
- **Remaining visits with a prepared renewal** (Abby Quick, Greg English, Brody Phillips) are allowed by design. They are only at risk through the check-in gap above.

## Remaining read-only steps
1. **Check past early activations.** For every one of the roughly 40 past automatic activations, compare the activating booking's Square note and the old package's Square position at that moment. Flag any that activated while the old package still had valid visits, with the money effect.
2. **Check today's exposure.** For every current prepared renewal, list:
   - stored date
   - Square first uncovered appointment
   - Square position and remaining visits
   - whether a booking on or after the stored date is unnumbered (meaning it would activate early under the current rule)
3. **Oct 19–23 verification.** Re-run live Master Dues and Weekly Dues, including the $5,410 Expected This Week figure. Then a test-only rerun puts each renewal on its stored date. List every client whose amount, week or category would differ, and confirm the live list uses Square timing. A mismatch in the stored date alone is not counted as an error.
4. **Save a CSV** with one row per client: `/mnt/documents/prepared-renewal-date-check_v1.csv`. Each row gets a verdict:
   - display only
   - record needs correction (with exact before/after)
   - Needs Review

## Proposed smallest fix (not built until you approve)
- **Check-in:** activate a prepared package only when one of these is true:
  - Square marks the visit 1/N, **or**
  - the current package is used up (by Square position, falling back to Hub).

  A missing number or a failed lookup alone never activates it.
- **Display:** label the stored date "Earliest eligible start". Show the Square first-uncovered date next to it on the client page and in dues text drafts.
- **Tests:** an unnumbered visit with visits left must not activate. A failed Square lookup must not activate. 1/N still activates. A used-up package still activates.

## Technical notes
- The gap is in `schedule.functions.ts` around lines 731-748, in `shouldActivatePreparedPackage` (`effective-visit-state.ts:334`), which returns true when `squareNote` is null. `squareNoteForBooking` returns null on any fetch error.
- Webhook: `square.webhook.ts:639` (`detectOverpayment` only).
- Dues texts: `dues-messaging.ts:217-241` and `dues-messaging.functions.ts:311`.
