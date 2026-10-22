# Phase 1: Stop stale dues numbers (no rule changes)

Scope is strictly "screens show the current truth". No changes to how money, renewals or visits are calculated, no record edits, no texts, nothing published.

## The problem today
Every screen keeps its own hand-written list of "things to reload" after a change. Those lists don't match: for example, the prepared-renewal card reloads Needs Renewal and the client, but not Master Dues, so Payment Due, Weekly Dues and the dashboard money tiles keep the old number for up to a minute. Check-ins from Schedule Check and Missed Check-Ins also skip Master Dues.

## What changes
1. **One shared "what changed" refresher.** A single helper with named events (renewal changed, package edited, payment recorded/moved, visit checked in/undone, client archived/restored, Square resynced). Each event knows every list it affects. All screens call it instead of their own lists, so new features can't forget one.
2. **Wire every change point to it**: prepared renewal create/edit/cancel, renew/undo renewal, package price/visit edits, payment record/reallocate, check-in from profile, Schedule Check and Missed Check-Ins, archive/restore, manual Square sync.
3. **Appointment reschedules/cancels**: after a Square sync finishes, refresh the renewal forecast and Master Dues so the expected renewal date moves.
4. **Never show old numbers as current.** If a dues refresh fails, Payment Due, Weekly Dues and dashboard money tiles show an "Out of date — last updated 9:42 PM · Retry" banner, and a "Updating…" hint while refreshing. Existing "Square unavailable" handling stays.

## Refresh vs recalculation
Reloading only helps if the recalculation is right. For each acceptance check I will compare the screen value to a fresh server calculation of the same client (read-only), not just watch the screen change.

## Verification (read-only, preview)
- Unit test: each event refreshes the expected lists (e.g. "renewal changed" includes Master Dues, Weekly Dues, client, dashboard).
- Browser checks against existing clients without saving financial changes where possible: Danielle Daigle (prepared renewal $200 owed), Brody Phillips and Greg English (prior-week renewal debt), one paid-up client, one with old-package debt. Confirm their totals before and after a reload are identical (nothing moved on its own), and that a harmless edit-and-revert on a test record updates all screens without a hard refresh.
- Simulate a failed refresh and confirm the "Out of date" banner appears.
- Full test suite + typecheck.

Anything requiring a real financial edit to test will be asked first.

## Technical details
- New `src/lib/invalidation.ts`: `invalidateFor(qc, event, { clientId })` mapping events to key prefixes: `master-dues`, `renewal-forecast`, `clients`, `client/<id>`, `activities/<id>`, `payment-allocations/<id>`, `visit-tracking/<id>`, `schedule-check`, `missed-check-ins`, `day-review`, `completed-visit-bookings`, `scheduled-client-ids`, `square_payments_*`. Weekly Dues already reads `master-dues`.
- Replace ad-hoc `invalidateQueries` blocks in PreRenewCard, clients.$id, schedule-check, missed-check-ins, sync-log, clients.deleted/new, ArchiveClientButton, PaymentAllocationsCard.
- Stale indicator uses React Query `isError`/`isFetching`/`dataUpdatedAt` plus `computed_at`.
- Test file `src/lib/invalidation.test.ts`. AGENTS.md rule: all post-mutation cache refresh goes through `invalidateFor`.
