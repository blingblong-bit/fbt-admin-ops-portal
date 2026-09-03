# Allow a second same-day check-in

## What's happening

A client booked twice in one day can only be checked in once. Two pieces of logic cause it:

1. The check-in itself has a "already has a visit today" block. It was added so a visit saved without a booking reference could never be double-counted. It fires even when the second check-in is a genuinely different appointment with its own booking reference.
2. The "Checked In" badge lookup also falls back to "any visit that day", so once one slot is checked in, every other slot for that client that day renders as already checked in.

## Fix

1. **Only use the day-level block when there is no booking reference.** If the appointment being checked in has a booking reference, the guard that matters is the exact one: has this specific booking already been recorded? If yes, block; if no, allow — even if the client already had an earlier visit that day. The day-level block stays in place only for check-ins with no booking reference at all, which is where double-counting was actually possible.

2. **Make the badge count-based instead of day-based.** For each client and day, match visits to appointments by booking reference first. Any leftover visit rows that have no booking reference get assigned to that day's remaining appointments in time order, one each. So one visit + two appointments = the first slot shows Checked In and the second is still checkable; two visits + two appointments = both show Checked In.

Net effect: same-day repeat appointments each get their own check-in, and the protection against double-counting a single appointment stays intact.

## Technical notes

- `completeVisitForClient` in `src/lib/schedule.functions.ts`: wrap the day-scoped fallback guard in `if (!data.bookingId)`; keep the exact `metadata.booking_id` guard unchanged.
- `getCompletedVisitBookingIds` in the same file: replace the `byClientDay` set with a per-`client|ymd` count of visit rows lacking `booking_id`, then sort each day's appointments by `start_at` and consume that budget for the ones not already matched by booking id.
- No schema or UI changes; Schedule Check already passes `{ booking_id, client_id, start_at }`.
