# Analeigh Spain — cancelled 7/8 booking investigation (read-only)

## What the code already tells us (confirmed by reading it)

- **Our Square booking helper does not filter by status.** It asks Square for every booking in a date window and keeps whatever comes back. It never drops cancelled or no-show bookings itself.
- **Visit Note Review drops them afterwards.** Before checking the sequence, it throws away any booking whose status contains CANCELLED, CANCELED, DECLINED or NO_SHOW. So if the 7/8 booking came back from Square as cancelled, Visit Note Review removed it, saw 6/8 → 8/8, and flagged a skipped visit.
- **Late cancels and no-shows are treated the same as timely cancels.** No-shows are dropped too, and the time of the cancellation is never looked at.
- **The helper doesn't keep "created" or "updated" times.** Square sends them, but our booking shape ignores them. We'll need them to tell whether a cancel was at least 1 hour before the appointment.

Status handling across the Hub today:

| Square status | Booking helper | Visit Note Review | Schedule Check / renewal / sweep |
|---|---|---|---|
| ACCEPTED, PENDING | kept | kept | kept |
| CANCELLED_BY_CUSTOMER | kept | dropped | dropped (shown as "cancelled" on Schedule Check) |
| CANCELLED_BY_SELLER | kept | dropped | dropped |
| DECLINED | kept | dropped | dropped |
| NO_SHOW | kept | dropped | dropped (shown as "no show" on Schedule Check) |

## What still needs live Square data

The Hub can't reach Square in planning mode, so these are still unknown:
- Whether Square still returns the 7/8 booking at all
- Its exact status
- Its created and updated times (the updated time is usually our best clue for when it was cancelled)

## Steps (nothing gets changed)

1. Add a temporary, signed lookup (same kind as the earlier Square diagnostics). It pulls Analeigh's Square bookings from 08/01/2026 to 10/15/2026 in two ways: by date window (how Visit Note Review does it) and by customer.
2. For every booking, report: booking ID, start date/time (Chicago), status, seller note, customer note, created_at, updated_at, and the note parsed as a visit number.
3. Answer the four questions directly:
   - Does the 7/8 booking still exist in Square?
   - What is its exact status?
   - Does our date-window pull return it? (This checks the helper isn't missing it.)
   - Is it removed only by Visit Note Review's cancelled/no-show filter?
4. Check whether Square gives any way to tell a timely cancel from a late one: updated_at vs start time, and any cancellation-related fields in the raw booking.
5. Remove the temporary lookup and confirm it's gone.
6. Report back. Then propose the rule change (a timely cancel doesn't count; a late cancel or no-show does), based on what Square actually gives us.

## Technical notes

- Temporary route under `/api/public/`, protected by an HMAC signature using an existing secret, read-only GETs to Square. It gets deleted right after.
- The raw booking JSON (all fields) is kept for the 7/8 booking, so we can see every field Square offers.
- No changes to Visit Note Review, the booking helper, the database or Square.
