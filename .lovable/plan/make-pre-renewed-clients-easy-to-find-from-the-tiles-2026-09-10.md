# Make pre-renewed clients easy to find from the tiles

## What I checked

There are 9 clients with a prepared (pre-renewed) next package, with start dates between 09/14 and 09/24.

Where they show up today:

- **Renewal Scheduled** tile — lists all 9. Visible by default, but shows no dollar amount.
- **Payment Due — Next Week** — the grouped detail now has a "Renewal Scheduled" section, and it reconciles with the tile's orange amount. But this tile is **not shown by default**; it only appears after clicking "Show more tiles", so most of the pre-renewed money is effectively hidden.
- Prepared renewals with no upcoming appointment are pushed to "later" and so never appear in either weekly view — only under Renewal Scheduled.

So the answer is: yes, but only if you know to unhide the Next Week tile, and the Renewal Scheduled tile gives no money signal.

## Proposed changes (admin/superadmin only, display only)

1. Show **Payment Due — Next Week** in the default tile set, next to Payment Due — This Week.
2. Add a dollar amount to the **Renewal Scheduled** tile: total prepared next-package amount, labeled "next packages prepared". Hidden for staff like the other money tiles.
3. Fix the **Needs Renewal** tile amount so it only counts un-prepared forecasts (today it adds prepared ones too), keeping the two tiles from double-reporting the same dollars.
4. In the Renewal Scheduled list, keep the existing renewal card and show the scheduled start date and amount per client, including the ones bucketed "later" so nothing is invisible.

No change to renewal logic, bucketing, payments, or the database.

## Technical details

- `src/routes/_authenticated/index.tsx`: add `payment_due_next_week` to `DEFAULT_VISIBLE_TILES`; split the existing `next_package_*_total` accumulators into prepared vs unprepared so the two renewal tiles can each read their own total; wire those into the `needs_renewal` and `renewal_scheduled` tile definitions with `staffHidden`/`isStaff` handling matching the other money tiles.
- Reuse `renewalMap` (`pre_renewed`, `next_package_price`, `pending_start_ymd`) — no new query.
- Extend the existing dashboard/grouping tests for the prepared-vs-unprepared totals, then typecheck and verify in the browser as an admin.
