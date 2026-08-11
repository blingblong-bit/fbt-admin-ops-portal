# Khloe Ewing "not checked in" — findings and fix

## What actually happened

Her check-in **did** go through. In the database:

- Her visit count moved to 8 of 8 at 4:30:45 PM today.
- A visit record was written at the same moment: "Visit completed (8/8) — from Schedule Check".

The problem is that visit record was saved **without the appointment reference** attached (the field that ties it to the specific Square booking is empty). Schedule Check decides who shows as "Checked In" purely by matching visit records to the booking IDs on screen. With no booking reference on her record, nothing matches, so her row renders as not checked in even though the visit was counted.

Every other check-in recorded today (11 of them, between 3:07 and 3:08 PM) has the booking reference attached, so this is not a broken-for-everyone bug. Why hers was missing the reference is **not yet confirmed** — the most likely explanation is a stale page/tab loaded from an older app version, but that needs verifying rather than assuming.

## Risk if left alone

Because her visit has no booking reference, the duplicate guard also can't see it. If someone presses Check In again on that appointment, it would try to add a 9th visit (that one errors out at 8 of 8 — but for a client mid-package the same situation would silently double-count).

## Plan

1. **Repair her record**: attach today's booking reference to her existing visit record so she immediately shows as Checked In and the duplicate guard protects her. No change to her visit count (stays 8 of 8).

2. **Make "Checked In" resilient**: change the checked-in lookup so a client also counts as checked in when they have a visit record on the same calendar day as the appointment shown, even if the booking reference is missing. This closes the whole class of "visit recorded but badge missing" cases rather than just this one row.

3. **Apply the same fallback to the duplicate guard**: block a second check-in when a visit for that client already exists for that appointment's day, so a missing booking reference can never allow a double count.

4. **Confirm the cause**: check whether any other recent visit records are missing the booking reference from the Schedule Check path (the batch on July 28 and earlier look like data backfills, not check-ins — that gets verified, not assumed). If the pattern points to a stale cached page, no further code change is needed beyond steps 2 and 3.

## Technical notes

- `getCompletedVisitBookingIds` in `src/lib/schedule.functions.ts` matches only on `metadata.booking_id`; it gains a client-id + appointment-date fallback, which means the caller must pass appointment `{ booking_id, client_id, start_at }` rather than bare booking IDs.
- `completeVisitForClient` idempotency guard gains the same day-scoped fallback check.
- Callers in `src/routes/_authenticated/schedule-check.tsx` (query at line ~239-247) updated to pass the richer appointment list.
- One-off data fix: set `metadata.booking_id` on activity `7aab1ced-…` to today's Square booking ID for her appointment.
