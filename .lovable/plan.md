# Jenny English: why 9/30 shows as her first uncovered visit

## What Square shows (read just now, nothing changed)
| Date | Status | Note |
|---|---|---|
| 9/14 | Accepted | 5 of 8 |
| 9/16 | Accepted | 6 of 8 |
| 9/21 | Cancelled by business | 7 of 8 |
| 9/23 | Cancelled by business | 7 of 8 |
| 9/28 | Upcoming | 7 of 8 |
| 9/30 | Upcoming | 8 of 8 |

## Cause (confirmed)
The system reads a client's current position from their **most recent past numbered appointment**, including cancelled ones. For Jenny that's the cancelled 9/23 "7 of 8", so it thinks she has used **7 of 8**, with only 1 visit left. Her upcoming visits are 9/28 and 9/30. 9/28 uses up that last visit, so 9/30 looks like it isn't covered by her package.

That "7 of 8" was never used. It was moved twice and is now booked on 9/28. Her real position is **6 of 8**, and both upcoming visits are covered by her current package.

The Visit Note Review page already treats a cancelled number that was rebooked on a later appointment as replaced, not as a problem. The part that works out her renewal date doesn't use that rule yet.

## Fix
- When working out where a client is in their package, ignore a cancelled numbered appointment if the **same number was rebooked on a later appointment that's still on**.
- Cancelled or no-show visits that were **not** rebooked still count, just like today (late cancels and no-shows use up a visit).
- Add tests: Jenny's exact pattern gives 6/8 and no renewal needed before 9/30. A late cancel that wasn't rebooked still counts.
- Re-run the read-only impact report. It will list every other client whose renewal date or Payment Due week moves because of this, before anything is published.

No stored visit counts, payments or texts change. Texting stays OFF, and nothing gets published.

## Technical details
- `resolveEffectiveVisitState` in `src/lib/effective-visit-state.ts` (`latest = pastNoted[last]`): exclude past cancelled entries where a later non-cancelled entry has the same `n/total` in the same run. Reuse the superseded logic from `square-visit-audit.ts` (lines ~203-212) as a shared helper.
- Covers renewal forecast, Payment Due, dues texts, last-visit texting and check-in display, since they all use this resolver.
