# Fix Angler Davis: a cancelled higher visit can't jump ahead of a later live visit

## Cause (confirmed in code)
When Hub works out a client's current position, it skips a cancelled visit only if the **same number** was rebooked. Angler's cancelled 8/8 was followed by a live **7/8**, a lower number, so it isn't skipped. Hub reads her as 8/8 and treats today's 7/8 as the start of the next package. The Visit Note Review page already recognises this pattern as "renumbered and rebooked". The position calculation just doesn't use that rule.

## Fix (narrow)
- A cancelled numbered visit is ignored **for the current position only** when the next live visit in the same package has a **lower** number. In that case the live visit is the real progression.
- Cancelled and no-show visits stay in the history and review sequence. They still count anywhere else they count today.
- Not changed: 6 live, 7 cancelled, 8 live still reads as 8/8 and clean. A late cancel that wasn't rebooked still uses up a visit. Same-number rebookings work as before. A normal renewal (cancelled 8/8, then 1/8) works as before.
- A future live visit counts only after it starts. So before Angler's 7/8 she is at 6/8 with 7/8 next. Afterwards she is at 7/8.

## Tests
1. 6 live, 7 cancelled, 8 live: current 8/8, clean
2. 6 live, 8 cancelled, future 7 live: current 6/8, next 7/8, no next-package start
3. Same as 2 after the 7/8 has happened: current 7/8
4. The cancelled 8/8 doesn't trigger package completion or renewal (forecast shows not started)
5. Same-number cancel and rebook still works (Jenny, Charles Parish)
6. All existing cancelled/no-show tests still pass

## Impact audit (read-only)
- Re-resolve every non-archived client with the old rule and the new rule, using live Square bookings.
- For each client whose position changes: name, old vs new position, and whether Needs Renewal, Renewal Scheduled, Payment Due/Master Dues, Dues Texts or the automatic renewal text would change.
- Then re-run Master Dues read-only as v3 (CSV), with a comparison to v2. Angler's $375 stays tracked. Her status should move from Upcoming to Prepared / no scheduled start, unless another real uncovered visit exists.

Run all lib tests and the typecheck. No publishing, no client record changes, no texts sent, and texting stays OFF.

## Technical details
- `src/lib/square-visit-audit.ts`: add `isOutrankedCancellation(seq, e)`. It requires `e` to be cancelled with e.n > 1. It then scans each later numbered entry in order. Both past and future entries count.
  - Any 1/N entry, **including a cancelled one**, stops the scan and returns false. This is a package boundary.
  - Any entry with a different total stops the scan and returns false.
  - A cancelled entry that isn't a boundary is skipped.
  - At the first live entry: return true if its total matches and 1 < n < e.n. Otherwise return false. There is no deeper search.
- Expected results:
  - 6/8, then cancelled 8/8, then 7/8: outranked
  - Cancelled 6/8, then 5/8: outranked
  - Cancelled 8/8, then 1/8, then 2/8: not outranked
  - Cancelled 8/8, then cancelled 1/8, then 2/8: not outranked
  - Cancelled 7/8, then 8/8: not outranked
  - Same-number rebooking: unchanged
- A future entry counts only as evidence for this comparison. It never adds to visitsUsed before it starts.
- `src/lib/effective-visit-state.ts` (lines 74 and 105): add this check to the `pastNoted` filter in the position step and the latest-day conflict check. Sequence and issue detection stay as they are.
- Tests go in `effective-visit-state.test.ts`. The audit and v3 dry-run are scripts in /tmp, with CSVs in /mnt/documents.
