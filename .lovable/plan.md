# Clarify weekly payment-due details

## Scope
- Apply the grouped detail experience to both **Payment Due — Next Week** and **Payment Due — This Week**, with Next Week as the primary flow.
- Keep both weekly payment tiles and all dollar details admin/superadmin-only. Staff accounts will retain the current restriction.
- Preserve the existing booking, current-balance, renewal forecast, and pre-renewal calculations.

## Detail view
For the selected week, replace the single mixed list with three sections:

1. **Current Package Due** — clients whose current-package balance is bucketed into that week.
2. **Renewal Scheduled** — next-package forecasts in that week with a prepared renewal.
3. **Needs Renewal** — next-package forecasts in that week without a prepared renewal.

A client may appear in the current-package section and one renewal section when both amounts genuinely contribute to the tile. Their cards will label each applicable amount separately rather than combining them without context.

## Totals and reconciliation
- Add a weekly summary showing current-package due, renewal scheduled, needs renewal, and the combined total.
- Derive section membership and totals from the same `amountOwed`, start-week bucket, and `RenewalForecastRow.week_bucket` values already used by the tiles.
- Ensure:
  - the current-package section equals the tile’s dark amount;
  - renewal scheduled plus needs renewal equals the tile’s orange amount;
  - combined equals all three sections.
- Keep empty sections visible with a zero total so reconciliation remains obvious.

## Card clarity
- Add visible **Payment Due**, **Renewal Scheduled**, and **Needs Renewal** badges as applicable.
- Current-debt cards show **Current balance** or **Current package owed**.
- Renewal cards show **Next package amount** and the renewal start date.
- Prepared renewals explicitly show **Renewal scheduled for [date]** and **Activates at check-in**.
- When the same client owes both amounts, show current, next, and total as separately labeled values.

## Export
- Update the weekly CSV export to use the same grouped data and include current amount, next-package amount, renewal state, start date, and combined amount per client.
- Keep non-weekly payment exports unchanged.

## Technical details
- Extract a pure weekly grouping/reconciliation helper from the dashboard calculations to prevent the tiles, sections, totals, and export from drifting apart.
- Reuse existing client cards and renewal controls where practical, adding explicit weekly payment display props rather than changing payment behavior.
- Add tests for section membership, pre-renewed versus unprepared renewal classification, clients contributing to both categories, and exact total reconciliation.
- Run focused tests and TypeScript validation, then verify the grouped weekly view in the browser.
