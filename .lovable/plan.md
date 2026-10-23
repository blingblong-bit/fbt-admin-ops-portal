# Renewals "Needs Attention" — diagnosis and proposed fix (nothing changed yet)

## What I found (read-only)
- 48 active clients have a prepared renewal; 34 of them have a "can start on or after" date that has passed (15 by more than a week).
- None of those 34 has a Hub check-in since their prepared start date. Hub check-ins fell from about 140 a week (mid-September) to 2–16 a week since Sep 28. The latest Hub visit for most of them is Sep 14–24.
- Prepared renewals only become the current package at a **Hub check-in** (Square 1-of-N or a used-up package). With almost no Hub check-ins, those renewals never activated. Square has moved on to the new package, but the Hub still shows the old package plus a "prepared" renewal.
- One admin package override already exists (set the week of Oct 19).

## Why they land in Needs Attention (exact causes)
1. **Wrong "no upcoming appointment" label (main cause).** The Renewals page reads the visit position from Square notes, which for these clients is the *new* package (e.g. 3 of 8). That package doesn't need renewal yet, so the client is dropped from the forecast. A second pass then re-adds every prepared renewal not already listed and marks it "Prepared, but no upcoming appointment is booked", even when appointments are booked. Clients already partway into the new package end up here.
2. **Too-broad visit-number review.** Any Square note problem in the last 180 days (an old conflict or a backward number) flags the whole client "Square visit numbers need review", even when the current position is clear.
3. **Stale Hub counters, not a re-renewal.** I found no client re-entering renewal right after a real activation. The data shows renewals that never activated, plus Hub visit counts that froze in late September.

Not verified: the exact split of the 34 clients across causes 1 and 2. That needs a live Square read, which I haven't done. The step-1 report below will produce those counts.

## Intended states
```text
Active (Square position has visits left, no prepared renewal) -> not listed
Needs Renewal (booked visits run past the package)          -> Needs Renewal
Prepared, not started in Square                             -> Scheduled
Prepared, Square already shows the new package started      -> "Started in Square - confirm" (new, admin action)
Prepared, truly no upcoming booking                         -> Needs Attention
Current Square position unreadable                          -> Needs Attention
```

## Proposed minimal fix (needs your approval)
1. **Read-only count first:** a one-off report listing each Needs Attention client with its exact reason, to confirm the split.
2. **Forecast:** mark "no upcoming" only when there truly is no live upcoming appointment. A prepared renewal with bookings that isn't due yet goes to Scheduled.
3. **Detect "started in Square":** a live past 1-of-N (or new-package numbering) on or after the prepared start date shows as "Started in Square — confirm". It is **not** activated automatically.
4. **Confirm action (admin):** one button that starts the prepared renewal through the existing protected renewal step, with the visit count taken from Square. The old package's money is carried exactly as it is today. No payments are created.
5. **Review flag:** only when the *current* Square position is unreadable, using the existing unreadable-position check, not on old history.
6. Raw records and overrides are not changed. Clients with overrides keep the admin figures they already show.

## Tests to add
- Prepared renewal with upcoming bookings that isn't due yet → Scheduled, not Attention.
- Truly no bookings → Attention.
- Square 1-of-N after the prepared start → "Started in Square", and nothing is auto-activated.
- Old resolved note conflict → not flagged. A same-day conflict on the latest visit → flagged.
- Confirming carries the old balance exactly once and blocks a second confirmation (existing renewal-boundary check).

## Separate question for you
Since staff mostly stopped checking in through the Hub, should prepared renewals start from Square alone (1-of-N on or after the "can start on or after" date) without a Hub check-in? That would change the current activation rule, so I've left it out of the fix above.

## Technical notes
- Cause 1: in `getRenewalForecast` (src/lib/schedule.functions.ts), rows with `!fc.needsRenewal` are skipped, and the pending-renewal pass then adds every unseen prepared client with `no_upcoming: true`. In `attentionReason` (src/lib/renewals-view.ts), `pre_renewed && no_upcoming` sends them to Attention.
- Cause 2: `reviewStatus` is `needs_review` whenever `detectNoteIssues` returns any issue across the window. Use `currentPositionUnreadable` instead for Attention.
- Started detection reuses `effectiveStateFor`, using `currentPackageStart` or a past live 1/N date compared with `pending_renewal_start_date`.
