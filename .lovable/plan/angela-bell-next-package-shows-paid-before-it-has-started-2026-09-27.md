# Angela Bell: next package shows paid before it has started

## What happened (confirmed from Square and her Hub history)
Square shows: 8/12 to 9/4 was 1/8 to 7/8. The 9/9 8/8 was cancelled. **9/16 was 8 of 8**, the last visit of that package. Her next package starts **9/30 (1 of 8)**, then 10/7 (2 of 8).

The Hub got it wrong:
1. On 9/8 a next package was prepared to start on **9/16**. It was based on the Hub count, which didn't account for the cancelled 9/9.
2. On 9/17 her 9/16 visit was checked in from Schedule Check. Because 9/16 was on or after the prepared start date, the Hub **started the new package early**. It closed the old one at 7/8 and logged 9/16 as "1/8" of the new package.
3. On 9/23 her $375 Venmo payment came through Square. It went onto the "current" package, which is really the one starting 9/30. So it shows as paid before she's started it. The money itself is correct: she did prepay the 9/30 package.
4. On 9/26 the Hub prepared **another** $375 package for 9/30 and an unsent $375 renewal text draft. That would charge her twice for the same package.

Her current visit count also shows 0/8 instead of 8/8.

## Fix for Angela (with your OK)
- Current package: the 8-visit package ending 9/16, marked **8/8 used and paid** ($375 from 8/12).
- Next package: 8 visits, $375, starting **9/30**, with **$375 already prepaid** (the 9/23 Venmo payment). Nothing owed.
- Remove the duplicate 9/30 prepared package and the unsent $375 draft.
- Add a note to her history explaining the correction. No money is added or removed.

## Stop it happening again
- For clients whose visits Square tracks, only start a prepared package when the appointment being checked in is numbered **1 of N** in Square. Being on or after the prepared date is no longer enough. If Square says 8/8, the visit counts on the old package and the new one waits.
- Hub-tracked clients keep today's date-based behaviour.
- Read-only sweep: find any other clients whose prepared package was started on an appointment Square didn't number 1/N. List them for you to review. Nothing is changed automatically.

Texting stays off; nothing is published.

## Technical details
- `schedule.functions.ts` check-in (around line 712): before activation, if `bookingId` and the client has a Square link, load that booking (`fetchSquareBookings` for that day) and parse its note. Activate only when `note.n === 1`. If there's no readable note, fall back to the date rule.
- Angela's data fix (run_sql on client d3fe676a…): `package_start_date` 2026-09-30, `visits_used` 0, `amount_paid` 375, clear `pending_renewal_*` fields, `pending_renewal_paid` 0. Delete the unsent renewal `dues_messages` row. Insert a `client_activities` correction note. The previous package stays recorded through the existing `package_completed` activity; add a note saying it actually finished 8/8 on 9/16.
- Sweep: for `renewal` activities with `source = pre_renewal_activation` and a `booking_id`, look up the Square note. Report the ones not numbered 1/N.
