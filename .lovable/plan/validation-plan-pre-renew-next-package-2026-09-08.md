# Validation plan: Pre-Renew Next Package

Important: this app has one shared database — the preview and the live site read the same records. There is no separate test environment. So the validation must not touch real client records. Everything below is run either read-only, or against temporary made-up test clients that are deleted at the end. Nothing will be published.

## How each case gets tested

Temporary clients (names prefixed `ZZ Test`, no Square link, removed afterwards) let the full flow be exercised safely. Because they have no Square bookings, the appointment dates are supplied directly to the check-in step, which is exactly what the real flow passes in.

1. **7/8 with two appointments** — create test client at 7/8, prepare next package starting on appointment #2. Confirm the count stays 7/8, the prepared start date/price are stored, the card reads "Renewal scheduled for …", and the weekly total counts the amount once. Then check in appointment #1 (expect 8/8, still pending), then appointment #2 (expect the old package saved to history, new package active, ends at 1 of new total).
2. **8/8 with one appointment** — same flow, confirming the count holds at 8/8 until that visit, then lands at 1 of the new total.
3. **4-visit package at 3/4** — confirm 4/4 after the first visit, 1/4 after the second.
4. **No prepared package** — attempt to check in past the package maximum; confirm it is refused with the renewal-required message and that 9/8 or 5/4 cannot occur, then renew and confirm 1 of new total.
5. **Editing a prepared package** — change price, visit total and start date; re-read from the database to confirm the changes persist, the active package is untouched, and the weekly amount changes exactly once.
6. **Cancelling a prepared package** — confirm the pending fields clear, the active package and debt are unchanged, history is intact, and the client falls back to the normal forecast amount.
7. **Owes money and has a prepared package** — confirm the two amounts stay separate before and after activation.
8. **Payment Due math** — with the real forecast (read-only), recompute This Week / Next Week / later totals and confirm each client contributes once, and that preparing a package does not add a second copy of the same amount.
9. **Check-in safeguards** — confirm preparing a package never changes visits, repeat check-in for the same appointment is still blocked, and check the ordering of the activation steps for any state left behind if one step fails.
10. **History and activity** — after activation, read the client's timeline and confirm one completed-package record with the correct final count, one renewal record, and no duplicates.
11. **Regression** — read-only inspection of payment sync, duplicate-payment protection, Notes reconciliation, archived/deleted filtering, Schedule Check and ordinary check-ins, plus a typecheck.

## Clean-up

Every temporary client and its activity records are deleted at the end, and the report confirms the deletion. No real client record is created, changed or deleted at any point.

## Report

PASS/FAIL per section, before/after visit counts for every scenario, whether any over-cap state (9/8, 5/4) was reachable, whether any next-package amount was counted twice, whether activation happened on the correct appointment, whether history was preserved, any bug found (and the fix proposed), and the typecheck result. Nothing is published.

## Technical notes

- Test rows are inserted directly into `clients` with `square_customer_id` null so they cannot collide with Square sync, and hard-deleted afterwards along with their `client_activities`.
- Activation lives in `completeVisitForClient` (`src/lib/schedule.functions.ts`); it runs as several sequential statements rather than one transaction, so the failure-window question in case 9 is inspected explicitly and reported.
- Forecast, pricing and bucketing checks read `getRenewalForecast` output against live data without writing.
- Any bug found is reported first; no fix is applied without approval.
