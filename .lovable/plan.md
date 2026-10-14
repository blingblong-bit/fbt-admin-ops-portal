# Dashboard money tiles: all from Master Dues

## What changes (admin dashboard only)
| Tile | New behaviour |
|---|---|
| Payment Due | Unchanged: master total; opens Payment Due |
| Payment Due — This Week | Clients and dollars matching the Payment Due **This Week** filter. Opens Payment Due with that filter |
| Payment Due — Next Week | The same, using the **Next Week** filter |
| Overdue — Prior Weeks | Renamed **Due Now / Overdue**: previous debt plus current balances only (already owed, whatever the timing). Opens Payment Due with the Due Now filter |
| Critical | **Hidden.** Master Dues has no defined urgency rule yet, so it would show a conflicting number |

Other tiles that currently show dollars outside Master Dues lose the dollar line. Their counts and workflow stay the same:
- **Renewal Scheduled:** stays workflow-only, count only.
- **Needs Renewal:** shows forecast money for packages not yet prepared, which isn't a Master Dues balance. Count only.
- **Dues Texts:** the draft-message amount is not a ledger. Count only.

Afterwards, every dollar figure on the admin dashboard comes from Master Dues.

## Rules kept
- No calculation rule changes and no record changes. No texts are sent, and texting stays off.
- Timing filters never change whether current debt is owed.
- **Staff dashboard unchanged.** Staff already don't see money.
- Payment Due History tile and other non-money tiles: unchanged.

## Report before publishing
- Payment Due total, This Week, Next Week and Due Now / Overdue, each with clients and dollars
- Confirmation that no tile uses a separate calculation
- Tests and type check
- A fresh signed-in dashboard screenshot
- No publishing

## Technical details
- `src/lib/master-dues-view.ts`: add `filterTotals(rows, filter, weekOf)` that returns `{clients, dollars}`. For timing filters, the dollars count only the matching buckets: the current balance in that window, plus renewal dollars expected that week. For Due Now, previous + current (+ renewal with status due_now, per the existing filter). This is plus a shared `weekOf` helper moved from the page.
- `/payment-due` accepts a `?filter=` search param (validated) so tiles can deep-link. The page and tiles use the same helper, so the tile number equals the page's "Shown" figure.
- `index.tsx` (admin only): those three tiles take `count`, `money` and `href` from `masterQ` plus `filterTotals`. Critical is excluded when not staff. `money` / `extraMoney` are removed from Renewal Scheduled, Needs Renewal and Dues Texts. The staff path is untouched.
- Tests: `filterTotals` for this week, next week and due now, including current debt expected next week staying in Due Now.
