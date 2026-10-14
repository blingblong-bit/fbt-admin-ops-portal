# Payment Due becomes the master dues screen

## What you'll see
- A new **Payment Due** page. The Payment Due tile on the dashboard opens it and shows the master total.
- **Summary at the top:**
  - Master Dues Total
  - Owed Now (previous + current balances)
  - Upcoming Renewals
  - Prepared — No Scheduled Start
  - Needs Review
  - Each figure shows its client count and dollars. Client counts can overlap, and the page says so.
- **One card per client, never repeated.** Each card shows:
  - Name and Total Tracked
  - Previous Debt (if any), always Due Now
  - Current Balance (if any), always Due Now, plus when it's expected to be collected: this week, next week, later, or no appointment
  - Renewal Balance (if any), with its status and expected date
  - The reason
- **Filters:** All · Due Now · This Week · Next Week · Upcoming Renewals · Prepared / Unscheduled · Needs Review.
  - This Week and Next Week filter by expected collection. They never change a balance's status.
- **Reconciliation line:** "Shown: N clients, $X. Difference from total: $0.00". The headline total uses only the Master Dues calculation, never the old one.
- **Dues Exceptions (separate, not counted in the total):**
  - Pay-per-visit clients, with their reason
  - Package Info Needed clients (no package price)
- Each card links to the client page. The existing admin-only Archive button stays where it is today.
- **Renewal Scheduled is unchanged.** It stays the renewal workflow page (progress, first uncovered appointment, prepared renewal, start, edit and cancel). It is not a second money list.
- **Who can see it:** admins only, because the page shows next-package amounts. Staff keep their current tiles.

## Safety
No calculation rule changes and no database changes. Nothing on the page can edit payments, finances or renewals. No texts are sent, and texting stays off.

## Before you approve publishing
- Run all tests and the type check.
- Sign in to the preview as you, and take a screenshot of the new page and of Renewal Scheduled working.
- Report the live client count and total, and confirm $0 difference.
- No publishing until you say so.

## Technical details
- New `src/lib/master-dues.functions.ts`: `getMasterDues` (createServerFn GET, requireSupabaseAuth plus an admin role check through `context.supabase`).
  - Loads non-archived clients and the shared Square booking index (`loadSquareBookingIndex`).
  - Builds per-client renewal timing exactly as in the v3 dry run: suppressed gives unknown; a past next-package start gives started; a first uncovered appointment goes through `timingFromUncovered`; otherwise no_start.
  - Also builds the next appointment date and the numbered-package set.
  - Returns `computeMasterDues(...)` unchanged.
  - If Square fails to load, it returns an error and the page shows "Square unavailable" rather than wrong totals.
- New route `src/routes/_authenticated/payment-due.tsx`: loader `ensureQueryData` plus `useSuspenseQuery`. Filtering and the reconciliation total are computed client-side from the returned rows. Includes its own head() title.
- Dashboard (`index.tsx`): for admins, the Payment Due tile links to `/payment-due` and shows the master total from the same `getMasterDues` query (shared queryOptions and cache key). There is no separate dashboard calculation, so the tile and the page headline always match. Staff behaviour and the other tiles are unchanged.
- Test: a small pure test checks that filter and reconciliation helpers keep shown rows summing exactly to the totals.
- Record the rule in `AGENTS.md`: Payment Due reads only from `computeMasterDues`, and Renewal Scheduled is workflow-only.
