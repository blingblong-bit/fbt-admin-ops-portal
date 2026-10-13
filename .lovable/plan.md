# Archive Client (manual, schedule-protected)

## What you get
- An **Archive client** button on the client page, plus a small Archive action on Payment Due / Overdue rows.
- Before archiving, the Hub checks Square live for upcoming appointments.
  - Any appointment today or later that is not cancelled, declined, or no-show blocks it: "Cannot archive — client is currently scheduled in Square."
  - Otherwise a confirmation window appears; confirming archives the client.
- Archived clients drop out of Active and Assessment views (same existing archived state already used by the Hub).
- A **Restore client** button on archived client pages returns them to Active.
- Nothing is ever archived automatically.

## What is preserved
Archiving only changes the client's status. History, payments, activities, package info, visits/check-ins, renewals, dues messages, and Square links all stay untouched. An "archived" / "restored" entry is added to the client timeline.

## Not changed
Payment, renewal, visit, dues, and texting logic. No publishing.

## Technical details
- `src/lib/archive-eligibility.ts`: pure `canArchive(bookings, now)` — active = start >= start of today (Chicago) and status not in CANCELLED_BY_CUSTOMER / CANCELLED_BY_SELLER / DECLINED / NO_SHOW.
- `src/lib/archive.functions.ts`: `checkArchiveEligibility`, `archiveClient`, `restoreClient` server fns with `requireSupabaseAuth` + admin/superadmin role check (`has_role`); staff are refused. Archive re-fetches Square bookings (uncached) server-side and refuses if blocked. If no `square_customer_id`, attempt existing reliable phone/email customer matching; if still unmapped or any Square fetch fails, block with "Square scheduling status could not be verified." No link never means allowed. Update sets only `status` (`archived` / `active`) and inserts a `client_activities` row.
- UI: client page header button + Payment Due row menu, using AlertDialog; buttons shown only to admin/superadmin; disabled with the blocked message after eligibility check.
- Test `src/lib/archive-eligibility.test.ts`: no upcoming → allowed; future ACCEPTED → blocked; future cancelled only → allowed; unverifiable Square → blocked; archive update payload contains only `status` (history fields untouched).
- Run `bunx vitest run src/lib` and type check, then report.
