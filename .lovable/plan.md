# Weekly Dues view (admin-only) — first build step

Goal: for a chosen Mon–Fri week, show who is expected to pay, prior-week unpaid carryover, and older outstanding debt — every dollar traced to Master Dues, no second money calculation.

## What gets built

1. **Pure weekly module** (`src/lib/weekly-dues.ts`) that takes the existing Master Dues rows plus each client's Square appointments and sorts every open dollar into exactly one section:
   - **Expected This Week** (grouped Mon–Fri): current balance when the client has an appointment that week (assigned to the first one); renewal when its first uncovered / new-package appointment falls that week; PPV obligations dated that week; weekly-billing obligation for that week.
   - **Prior Week Carryover**: open PPV/weekly obligations dated in the previous work week (remaining unpaid amount only).
   - **Older Outstanding**: previous-package debt, current balances with no appointment that week, renewals already Due Now with no appointment that week, and PPV/weekly obligations older than the prior week.
   - Not counted (shown as a note only): Upcoming renewals outside the week, Prepared/no-start, Needs Review, and existing exceptions (Package Info Needed, billing review).
   - Each item keeps type, date/time, reason; clients with several pieces show pieces plus a client total.
   - Reconciliation: X + Y + Z = shown total; unexplained = $0; each obligation appears once.
2. **Data**: `getMasterDues` additionally returns each client's Square appointment start times for previous/current/next week (from the booking index it already loads). Additive only — no Master Dues rule changes, totals unchanged.
3. **/weekly-dues page** (admin-only): week selector (Previous / Current / Next, date range like "Oct 19–23"), four summary cards (Expected, Carryover, Older Outstanding, Total Actionable) with client counts, weekday sections, filters (All, Mon–Fri, Carryover, Older Outstanding, Renewal, Current Balance, PPV/Weekly), reconciliation footer. Square failure shows "unavailable", never stale totals.
4. **Dashboard tile** (admin only): current-week expected, prior-week carryover, total actionable → opens /weekly-dues. Staff dashboard unchanged.

## Rules respected
- Live Square timing and the corrected renewal-boundary logic; a stored date passing never makes a renewal due.
- PPV per appointment; weekly billing once per week; payments already reduce obligations via Master Dues; no generic credit.
- Previous/next week views are a projection: future weeks show forecast obligations only through the simulator's existing next-week horizon.

## Read-only preview and stop
- Run the module live for Oct 19–23, 2026 and return: Expected total, carryover, older outstanding, total actionable, full client list by weekday, $0 reconciliation. Also save a CSV to Files.
- Tests for: section exclusivity, carryover = unpaid only, weekly once per week, renewal not due from date alone, reconciliation $0.
- Run tests and typecheck. No client records changed, no texts, no publishing.

## Open point
Note: Oct 19–23 is next week relative to today, so "Prior Week Carryover" for that view means open obligations dated Oct 12–16 as of now (payments made the rest of this week would reduce it).
