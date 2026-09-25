# Keep cancelled/no-show bookings in Visit Note Review

## What changes
- Visit Note Review stops throwing away cancelled, declined and no-show bookings. Any booking with a valid visit number stays in the sequence, whatever its status.
- Each chip on the review card shows the Square status when it isn't a normal booking, e.g. "7/8 · Cancelled by seller 09/16", "7/8 · No show".
- Flags only look at the numbers themselves:
  - 6/8 Accepted → 7/8 Cancelled → 8/8 Accepted: no flag
  - 6/8 → 8/8 with no 7/8 anywhere: skipped-number flag
  - 5/8 → 4/8: backward flag
  - 8/8 → 1/8: normal renewal, no flag
- Cancelled/no-show bookings with **no** visit number stay out of the "missing note" check, so a cancelled un-noted appointment doesn't cause a flag. They are still shown on the card as "no note · Cancelled".
- No cancellation timing rules. No changes to Square data, the database, visit counts, renewals, the sweep or Schedule Check.

Expected result: Analeigh Spain drops off the review list.

## Technical details
- `src/lib/square-visit-audit.ts`
  - `buildSequence`: remove the CANCELLED filter; keep `status` on each `SequenceEntry` and add a `cancelled` boolean (CANCELLED|CANCELED|DECLINED|NO_SHOW).
  - `detectNoteIssues`: logic unchanged except the missing-note count ignores entries where `cancelled && !note`.
- `src/lib/visit-note-review.functions.ts`: `NoteChip` gains `status: string | null` (only set for non-accepted/pending statuses).
- `src/routes/_authenticated/visit-note-review.tsx`: chips show a friendly status label (Cancelled by seller / Cancelled by client / Declined / No show) with muted styling.
- Tests in `square-visit-audit.test.ts`: add the four examples above, plus cancelled un-noted booking not producing a missing-note flag. Run tests and typecheck.
- Then check the live list and report how many flags cleared.
