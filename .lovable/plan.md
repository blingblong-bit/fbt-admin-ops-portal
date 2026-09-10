# Fix Missed Check-In matching and duplicate blocking

## Changes

1. Restore appointment fallback matching to a client-and-calendar-day budget. A booking-less visit can mark only an appointment on the same clinic day, so the summary and individual day view always agree regardless of how many days were loaded.
2. Keep duplicate protection exact when a booking ID is supplied. Only an existing visit carrying that booking ID blocks Check In; unrelated walk-ins and booking-less manual visits do not.
3. Keep the existing no-booking same-day guard for manual “No appointment” entries and leave the dismissal controls unchanged.
4. Add focused tests for single-day versus multi-day matching and booking-linked duplicate behavior, then validate the affected screens and resolve both monitoring findings.

## Technical details

- Update `resolveCheckedInBookingIds` in `src/lib/schedule.functions.ts` to consume reference-less visits within `client_id + clinic YYYY-MM-DD` buckets instead of across a multi-day client queue.
- Remove the Square-fetch attribution guard from `completeVisitForClient`; retain its direct `metadata.booking_id` idempotency query.
- No database, package, payment, or historical record changes.
