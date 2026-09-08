# Needs Renewal driven by upcoming appointments

Make Hub decide renewals from the appointment schedule instead of Notes: a client needs renewal as soon as they have booked more visits than their current package can cover.

## The rule

For each client: `remaining = total visits − visits used`. Take their upcoming non-cancelled Square appointments in time order. The first `remaining` of them are covered by the current package. If any appointment remains after that, the client needs renewal and that appointment is the first visit — and the start date — of the next package.

So 8/8 with 1 booking qualifies, 7/8 with 1 does not, 7/8 with 2 does (appointment #2 starts the new package), 3/4 with 2 does.

Clients with no package set up (0 total visits) and clients with no visit tracking are left out — they stay in the existing "First Visit — No Package Info" group.

## What the Needs Renewal list shows

One card per qualifying client with: name, visits used / total, remaining visits, number of upcoming appointments, the first uncovered appointment, the projected new package start date (that appointment's date), the client's current package price, and the next-package amount owed.

Next-package amount defaults to that client's own current package price — $345, $375, $200, $185, whatever they actually pay — never a fixed number. Staff can type a different amount on the card; the override is remembered per client until the renewal is completed or cleared.

## Payment Due

The projected next-package amount is added to the weekly totals by the date of the first uncovered appointment:

- falls in the current work week (Mon–Fri) → counts in Payment Due — This Week
- falls in next work week → counts in Payment Due — Next Week
- farther out → shown in Needs Renewal only, not in either weekly total

Current-package debt and next-package debt are tracked separately and shown separately on the card ("Owes now" vs "Next package"), so one never overwrites the other. A client can appear with both. Overdue — Prior Weeks keeps using current-package debt only.

## Renew Package

Opened from a Needs Renewal client, the dialog defaults the start date to the first uncovered appointment (still editable), and defaults the price to the next-package amount shown on the card. On save it keeps today's behaviour — visits reset to 0, visit total preserved unless changed, activity logged — and additionally clears the pending next-package amount so the client drops off Needs Renewal and their new balance moves into normal Payment Due.

## Check In

Unchanged. Check In stays the only thing that increments visits; appointments are used purely to forecast when the next package starts.

## Untouched

Square payment sync, duplicate-payment protection, idempotency, activity timeline, package history, Notes import/reconciliation (kept for comparison), archived-client filtering, and check-in behaviour all stay exactly as they are.

## Technical notes

- New server function `getRenewalForecast` in `src/lib/schedule.functions.ts`: pages Square bookings across the next 90 days in 31-day windows (Square's cap), drops cancelled/declined/no-show and past bookings, groups by `square_customer_id`, joins non-deleted non-archived clients with `package_total_visits > 0` and non-null `visits_used`, and returns per client `{ client_id, remaining, upcoming_count, appointment_ymds, first_uncovered_ymd, week_bucket }` where the bucket is derived with the existing `workWeekStartFromYmd` Mon–Fri helper.
- `src/routes/_authenticated/index.tsx`: the `needs_renewal` count and filter switch from "remaining === 0 && scheduled" to membership in the forecast; the payment-due counters add `next_package_owed` for forecast rows whose bucket is `this`/`next`, kept in separate accumulators from current-package owed.
- One additive migration: nullable `next_package_price numeric` on `clients` for the staff override (null = use `package_price`); cleared by Renew Package. No other schema change.
- `RenewDialog` in `src/routes/_authenticated/clients.$id.tsx`: reuse the existing earliest-appointment prefill, but pass the forecast's first uncovered appointment when available, seed price from `next_package_price ?? package_price`, and null out `next_package_price` in the same update.

## Validation

Compare the resulting Needs Renewal list against the 15-client simulation already run (7 currently listed, 8 added, none dropped), then typecheck.
