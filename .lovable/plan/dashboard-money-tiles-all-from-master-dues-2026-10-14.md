# Dashboard money tiles: all from Master Dues

## What changes (admin dashboard only)
| Tile | New behaviour |
|---|---|
| Payment Due | Unchanged: master total; opens Payment Due (All) |
| Payment Due — This Week | Clients and dollars expected this week. Opens Payment Due with `filter=this_week` |
| Payment Due — Next Week | The same for next week. Opens Payment Due with `filter=next_week` |
| Overdue — Prior Weeks | Renamed **Due Now / Overdue**: every Master Dues dollar due now (previous debt, current balances, and renewals already Due now). Opens Payment Due with `filter=due_now` |
| Critical | **Hidden.** Master Dues has no defined urgency rule yet |

Three other tiles show dollars that aren't Master Dues balances. They lose the dollar line and keep their counts and workflow:
- Renewal Scheduled (workflow-only)
- Needs Renewal
- Dues Texts

Afterwards, every dollar figure on the admin dashboard comes from Master Dues.

## Rules kept
- No calculation rule changes, no record changes, and no texts. Texting stays off.
- Timing filters never change whether current debt is owed.
- The staff dashboard is unchanged.

## Report before publishing
- Master total, plus This Week, Next Week and Due Now / Overdue, each with clients and dollars
- Confirmation that every dollar comes from Master Dues
- Confirmation that each tile matches its filtered page exactly
- Tests and type check
- A fresh dashboard screenshot
- No publishing

## Technical details
- `src/lib/master-dues-view.ts`: add `filterTotals(rows, filter, weekOf)`, which returns `{clients, dollars}` with bucket-level dollars:
  - this_week / next_week: the current balance whose expected window matches, plus renewal dollars expected that week
  - due_now: previous + current + renewal with status due_now
  - all: row totals
- `weekOf` becomes a shared helper.
- `/payment-due` takes a validated `?filter=` search param. Its "Shown" line uses `filterTotals`, so each tile equals the page's Shown figure exactly. All still equals the master total.
- `index.tsx`, admin only:
  - The three tiles take count, money and href from `masterQ` + `filterTotals`.
  - Critical is excluded for admins.
  - Money is removed from Renewal Scheduled, Needs Renewal and Dues Texts.
  - The staff path is untouched.
- Tests: `filterTotals` for each filter, including current debt expected next week also counting in Due Now, and All equal to the master total.
