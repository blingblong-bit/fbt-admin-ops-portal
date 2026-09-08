# Keep old package debt separate, and keep prepared renewals visible

Two fixes: unpaid money from a finished package must survive a renewal instead of vanishing, and a prepared next package must stay visible even if the client's bookings get cancelled.

## Previous Package Owed

Today, when a package renews (either the Renew Package button or a prepared package activating at check-in), the paid amount resets to zero and the new price becomes the balance — so anything still unpaid on the old package silently disappears.

New behaviour at renewal:

- Whatever was still unpaid on the finished package is moved into a separate "Previous Package Owed" amount on the client.
- The new package starts with its own normal balance (its price, nothing paid yet).
- If the client already had previous-package debt, the new amount is added to it, so nothing is ever overwritten.
- The completed-package record in their history notes how much was left unpaid, so the origin of the old debt stays traceable.

## What staff see

Client detail money section shows three lines:

- Previous Package Owed (only when it isn't zero)
- Current Package Owed
- Total Owed

Client lists, cards, dashboard tiles, exports and the merge screen use Total Owed wherever a single "owes" figure is shown, so no amount is dropped or shown twice.

## Payment Due tiles

- Payment Due totals use Total Owed, each amount counted exactly once.
- Previous Package Owed always counts in Overdue — Prior Weeks, whatever the client's schedule looks like. This Week / Next Week stay about the current package.
- A client with both kinds of debt shows in both places, each amount once.

## How payments clear it

Square payments and manually recorded payments clear the oldest debt first: the previous-package amount is paid down before anything counts against the current package. Any leftover flows onto the current package as it does today. No manual "apply to which package" choice for now. Duplicate-payment protection and one-time application are unchanged.

## Prepared renewal with no upcoming appointment

If staff prepared a next package and then every upcoming booking is cancelled, the client currently vanishes from Needs Renewal while the prepared package sits there invisible.

New behaviour: they stay in Needs Renewal in a "Prepared Renewal — No Upcoming Appointment" state, showing the prepared start date, price and visit total, with Edit and Cancel still available. They are not counted in Payment Due This Week or Next Week unless their prepared start date actually falls in one of those weeks.

## Technical notes

- Migration: `previous_package_owed numeric not null default 0` on `clients`. The `clients_validate` trigger is extended to floor it at 0.
- `apply_square_payment` is updated to pay down `previous_package_owed` first, then increment `amount_paid` with the remainder, inside the same locked transaction; its activity metadata records the split. `recordManualPayment` in `src/lib/payments.functions.ts` follows the same order.
- `src/lib/clients.ts`: `amountOwed` keeps its current-package meaning; add `previousOwed()` and `totalOwed()`. `computeStatus`, `simpleStatus`, `effectiveStatus` and `primaryAction` switch to `totalOwed`.
- Renewal paths both write the carry-over: `completeVisitForClient` activation block (`src/lib/schedule.functions.ts`) and `RenewDialog` (`src/routes/_authenticated/clients.$id.tsx`); the `package_completed` activity metadata gains `unpaid_carried_forward`.
- `src/routes/_authenticated/index.tsx`: tile maths uses `totalOwed` for Payment Due, and adds `previousOwed` into Overdue — Prior Weeks unconditionally, with the current-package portion still bucketed by start date so nothing double-counts.
- `getRenewalForecast`: after the booking-driven rows are built, append rows for non-archived clients that have `pending_renewal_start_date` set but produced no forecast row, flagged `no_upcoming: true`; week bucket derived from the prepared start date only. `PreRenewCard` renders the no-appointment variant.
- Consumers of `amountOwed` in `SmartClientCard`, `clients.index.tsx`, `clients.deleted.tsx`, `merge-center.tsx`, `backup.tsx` move to `totalOwed`.

## Validation before publishing

Re-run the pre-renewal test suite on temporary throwaway records, including the case that failed: a client owing money on the current package who is pre-renewed and activated — expect old unpaid amount preserved as previous debt, new package at full price, total correct, no double-count. Plus a Square payment applied against a client with both debts, cancel/edit of a prepared renewal with no bookings, and the earlier regression set (no over-cap visit counts, history intact, forecast totals, typecheck). Report results; nothing is published until you approve.
