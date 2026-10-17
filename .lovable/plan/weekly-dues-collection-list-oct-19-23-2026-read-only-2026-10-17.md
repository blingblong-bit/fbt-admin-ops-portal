# Weekly Dues Collection List — Oct 19–23, 2026 (read-only)

## 1. Check whether the app is published
- Compare the published app with the current preview: check that the renewal-timing fix, admin workflow tools, and payment ledger are live.
- If they aren't live, list what still has to happen before publishing (your approval, the final build check, and making sure database changes are already active, since preview and the live app share one database). I won't publish anything.

## 2. Build the report with the shared calculation
- Run the same Master Dues calculation that Payment Due uses, then split it into the Oct 19–23 work week with the existing Weekly Dues module. No separate money logic.
- Sections: Expected This Week, Prior Week Carryover (Oct 12–16, still provisional and recalculated live), Older Outstanding. They don't overlap.
- If Square data is unavailable, the report will say so. It won't fall back to old totals.

## 3. Exclusions (shown as their own list, not deleted)
- Always held: Katie Farrier, Nick Smith, Keri Evans. Reason: billing arrangement waiting for Dad's confirmation.
- Also held, but only if the issue could change what we collect:
  - unknown or unclear billing type, or missing package info
  - Payment Review status, or a payment allocation marked Needs Review that touches the amount owed
  - a package boundary marked Needs Review, or incomplete Square data affecting the amount owed
- Not held for an unrelated review flag. Each held client gets the exact reason and amount.

## 4. Renewal check
- Confirm upcoming renewals (including Melani McKamey, $345, expected Nov 6) are listed as Upcoming and not counted in Oct 19–23.

## 5. What you'll get back
- Total actionable dues and number of clients
- Totals for each category, plus a client list with amount, billing type, and reason for the charge
- Held clients with reasons and amounts
- Reconciliation: Master Payment Due = actionable + held + not due this week + upcoming, with $0 unexplained
- Anything still blocking staff from using the list Monday
- CSV: `/mnt/documents/weekly-dues-collection_2026-10-19.csv`

## Technical details
- Use `getMasterDues`/`computeMasterDues` → `src/lib/weekly-dues.ts` with an exclusion overlay applied after slicing, so the totals still reconcile.
- Reads only, plus the existing tests and typecheck. No record changes, payments, texts, Square writes or publishing.
