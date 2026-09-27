# Katie McNabb: why her account looks wrong

## What Square shows (read just now, nothing changed)
| Date | Status | Note |
|---|---|---|
| 8/24 to 9/15 | Accepted | 1 of 9 to 8 of 9 |
| 9/16 | Accepted | 9 of 9 (package finished) |
| 9/17 | Cancelled by business | 1 of 9 |
| 10/1 | Upcoming | 1 of 8 |
| 10/2 | Upcoming | 2 of 8 |

So she finished her 9-visit package on 9/16 (paid $360 on 8/28). Her new 8-visit package starts 10/1.

## What went wrong (confirmed)
1. **The cancelled 9/17 "1 of 9" is being treated as a visit she used.** The rule from Jenny's fix only ignores a cancelled number when the *exact same* number is rebooked later. Katie's was rebooked as "1 of 8" (the package size changed from 9 to 8), so the rule missed it. The app thinks she's 1 visit into a new 9-visit package. Then the upcoming "1 of 8" looks like her numbering went backwards and changed size, so her visit count gets held or shown incorrectly.
2. **The app never closed out her 9-visit package.** A prepared renewal starting 9/17 was waiting, but when that appointment was cancelled it was never switched on.
3. **Edits made in the last few minutes** (03:03 to 03:05 UTC) changed the prepared start to 10/1, then cancelled it, then edited her details. Her current package now reads: 8 visits, $360, starts 10/1, 0 used, $0 paid. There's also a $360 renewal text draft (not sent). The finished 9-visit package has no "package completed" entry in her history.

## Fix
- **Visit logic:** a cancelled or no-show numbered visit also counts as replaced when a **later appointment that's still on starts a new package** (a 1 of N, any size). That means the cancelled 1 of 9 is ignored, she reads as 9/9 complete, and her next package starts 10/1.
- A late cancel or no-show that is **not** rebooked still counts as a used visit, same as today.
- Add tests: Katie's exact pattern gives 9/9 complete with the next package on 10/1. Jenny's pattern still gives 6/8. A late cancel that wasn't rebooked still counts.
- Re-run the read-only impact report and list every other client whose count, renewal date, Payment Due week or dues draft changes.
- **Katie's saved record:** I won't change anything automatically. Her current setup (8 visits, $360 due, starts 10/1) matches Square going forward. I'll tell you if anything else looks off. I'll only add a "package completed" history entry for the 9-visit package if you ask.

Texting stays OFF and nothing gets published.

## Technical details
- `isSupersededCancellation` in `src/lib/square-visit-audit.ts` should also return true when the cancelled entry is followed later in the sequence by a non-cancelled entry with `n === 1`, and the cancelled entry is `n === 1` or comes after an `N/N`. Keep the existing same `n/total` rule.
- `detectNoteIssues` should skip superseded cancellations so `9/9 → (cancelled 1/9) → 1/8` doesn't raise `backward` or `package_size`. That keeps `currentPositionUnreadable` false.
- Add tests to `effective-visit-state.test.ts` and `square-visit-audit.test.ts`.
