# Don't mark a renewal "started" from an already-completed package boundary

No client records change, no activations, nothing is published or texted. Jay's missing history stays as it is.

## Rule
A past "1 of N" boundary counts as the start of the *prepared* renewal only when the Square package it opened is still in progress. If that package has already reached its final visit (N of N), the prepared renewal belongs to the next package. Its timing then comes from the next live "1 of N" or the first uncovered appointment, so it shows as Upcoming until that appointment time passes, and as Due Now after that.

For Jay Reynolds:
- His renewal stays pending.
- He shows as Upcoming 10/28.
- He moves to Due Now only once the 10/28 "1 of 8" has actually started.
- No other renewal is created.

## Tests
1. Jay pattern: past 1/8 on 8/26, then 8/8 on 9/30, a cancelled 1/8 on 10/06, and a live future 1/8 on 10/28 → Upcoming 10/28, not Due Now.
2. Same pattern after 10/28 has started → Due Now.
3. Emma pattern: past 1/8, now at 3/8 and still in progress → still Started (no regression).
4. Completed package, nothing booked after it → Prepared, never Due Now.

Then run the full tests and typecheck, and stop.

## Technical details
- Move the renewal-timing decision out of `getMasterDues` into a pure `renewalTimingFor(client, state, upcomingStarts, nowIso)` in `master-dues.ts`, so it can be tested. The boundary branch requires `used < total` on the Square package. Otherwise it falls through to the existing `nextPackageStart` / first-uncovered logic.
- `getMasterDues` calls the helper, so dashboard tiles and Payment Due stay on the same path.
