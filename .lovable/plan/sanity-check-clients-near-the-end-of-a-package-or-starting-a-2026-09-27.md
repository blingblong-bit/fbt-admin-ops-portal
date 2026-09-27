# Sanity check: clients near the end of a package or starting a new one this week (read-only)

## What you'll get
A list built from live Square appointment notes for **this week, Mon Sep 28 – Sun Oct 4 (Chicago time)**, split into three groups:

1. **Near the end of a package**: any appointment this week numbered 6/8, 7/8 or 8/8. For other package sizes, the last three visits count (for example 2/4, 3/4, 4/4 or 4/6–6/6).
2. **Starting a new package**: any appointment this week numbered 1/N.
3. **Can't tell**: appointments this week for package clients with no visit number, or numbering that Square doesn't agree with itself on. You'll need to look at these yourself.

For each client you'll see: name, appointment date(s) and Square note(s), whether each appointment is live or cancelled/no-show, the visit count the Hub shows today, and what the Hub expects them to owe this week. Anything where the Hub disagrees with Square gets flagged, such as:
- Hub not expecting a renewal but Square shows 1/N
- Hub expecting a renewal but Square shows the current package still going
- a different package size
- no Square link

## Guarantees
- Read-only. No changes to clients, payments, packages, drafts, or anything in Square.
- Texting stays off. Nothing gets published.
- The results come to you as a table in chat, plus a downloadable spreadsheet.

## Technical details
- Add a temporary signed read-only endpoint (same pattern as the removed `square-diag`). It calls `loadSquareBookingIndex(token, 14, 14, { fresh: true })` and `parseVisitNote` / `buildSequence` for every Square-linked active client, then keeps bookings whose `start_at` falls in 2026-09-28 00:00 to 2026-10-04 23:59 America/Chicago.
- Include cancelled, no-show, and declined numbered bookings, labelled with their status. Mark cancellations that were later rebooked as superseded, using `isSupersededCancellation`.
- Pull the Hub side (`visits_used`, `package_total_visits`, pending renewal, and the Payment Due forecast) through `effectiveStateFor` and the existing forecast path so both columns use the same rules.
- Export a CSV to /mnt/documents/week-sep28-package-positions.csv, then delete the temporary endpoint in the same session.
