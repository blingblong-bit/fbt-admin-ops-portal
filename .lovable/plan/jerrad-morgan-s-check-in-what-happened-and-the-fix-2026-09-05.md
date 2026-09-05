# Jerrad Morgan's check-in — what happened and the fix

## The check-in did save

His record shows the visit was counted today at 10:08 AM: visit 6 of 8, recorded from Schedule Check, with the appointment reference attached correctly. Nothing was lost.

## Why the screen doesn't show it

The part of Schedule Check that decides who gets the "Checked In" label asks the database for the list of recorded visits — but it asks for them all at once with no paging. The database caps that kind of request at 1000 records and silently returns only the first 1000, in storage order.

There are now 1005 visit records. His is the newest one, so it falls past the cut and the page never sees it. Yesterday's late check-ins are right at the edge of the same cliff. This will get worse with every new check-in: as the list grows, more and more recent check-ins will stop showing their badge.

## Fix

1. Stop asking for every visit record ever recorded. Only look up the visits that matter for the appointments currently on screen: filter to the clients shown and to a date window around those appointments. That keeps the result far under the cap and makes the page faster.
2. Add paging as a safety net, so even a large result is fetched completely instead of quietly stopping at 1000.
3. Same treatment for the duplicate-check on the check-in action, so a truncated read can never let one appointment be counted twice.

No data repair is needed — his visit count is already correct at 6 of 8. Once this ships, his row (and the other recent ones) will show as Checked In again.

## Technical notes

- `getCompletedVisitBookingIds` in `src/lib/schedule.functions.ts` does `.select(...).eq("activity_type","visit")` with no `.in("client_id", …)`, no date filter and no `.range()` — PostgREST's 1000-row default cap truncates it. Confirmed: 1005 `visit` rows exist; the newest (Jerrad's, `booking_id a1fvkg0hgh36uw`) is beyond the cap.
- Narrow the query to the distinct `client_id`s from the passed appointments plus a `created_at` window spanning the appointment dates (±1 day for timezone edges), then loop `.range()` in 1000-row pages until a short page comes back.
- Keep the existing booking-id-first matching and the per-client/day leftover assignment logic unchanged.
