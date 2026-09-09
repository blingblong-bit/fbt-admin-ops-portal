# Missed Check-Ins can count a visit twice

## Confirmed

A visit recorded from the client's own page is saved with no appointment reference, and it is stamped with the day it was typed in, not the day of the appointment.

The Missed Check-Ins screen decides "already checked in" two ways: an exact appointment reference, or a reference-less visit recorded on the same calendar day as the appointment. A catch-up entry for yesterday's appointment, typed today, matches neither. So the row still says "Missed Check-In", and pressing Check In there records a second visit — the duplicate guard only looks for the exact appointment reference, which the manual entry never had.

Net effect: the client is charged two visits for one appointment and reaches "package complete" early.

## Fix

1. **Stop creating untagged visits from the client page.** The "Complete Visit" button on a client's page currently writes the visit itself. Route it through the same shared check-in the rest of the app uses, so every visit is created by one code path with the same guards and the same logging.

2. **Let staff say which appointment a manual visit is for.** When a client has recent appointments with no recorded check-in, the Complete Visit action offers them and attaches the chosen one. Choosing "no appointment" is still allowed and keeps today's behaviour.

3. **Match reference-less visits by appointment, not by the day they were typed.** For a client, take their visits that carry no appointment reference and hand them out to that client's un-matched past appointments in time order, oldest first, instead of requiring the recording date to equal the appointment date. A visit typed today for yesterday's appointment then correctly marks yesterday's row as Checked In.

4. **Apply the same rule to the duplicate guard.** Before a check-in with an appointment reference is accepted, also confirm there is no unattributed visit that already belongs to that appointment under rule 3. This closes the double-count without blocking a client genuinely booked twice in one day.

## Trade-off to accept

Rule 3 means a reference-less visit can be attributed to an earlier un-matched appointment rather than the one staff had in mind. That errs toward "already handled" instead of "count it again", which is the safer error for visit counts. Rules 1 and 2 make new untagged visits rare going forward.

## Technical notes

- `src/routes/_authenticated/clients.$id.tsx`: replace the direct `clients.visits_used` update + bare `client_activities` insert in `completeVisit` with `completeVisitForClient`, passing an optional `bookingId`/`appointmentStartAt` from a small appointment picker fed by recent un-checked-in appointments.
- `src/lib/schedule.functions.ts` / `resolveCheckedInBookingIds`: replace the `client_id|ymdInTz(created_at)` bucket count with a per-client queue of reference-less visit rows ordered by `created_at`, consumed by that client's unmatched probes ordered by `start_at`, restricted to appointments at or before each visit's recording date.
- `completeVisitForClient`: when `bookingId` is present, after the exact-reference guard, run the same attribution against the client's appointments in the window and reject if this booking is already covered by a reference-less visit.
- No schema change. Verify with typecheck plus a read-only replay over the last two weeks comparing Missed counts before/after.
