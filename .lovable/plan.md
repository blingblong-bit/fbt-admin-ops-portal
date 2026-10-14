# Same-size renewal detection fix + Emma payment trace (no activations)

No clients are activated, no records change, nothing is published or texted.

## What the trace already shows for Emma
- Current package: 8 Sessions, started 9/04, $375.
- **Payment 1:** $375 Venmo through Square on 9/08. It went to the 9/04 package, so the old package is fully paid.
- **Payment 2:** $375 Venmo through Square on 10/06 at 04:44 UTC. That was about 13 hours before her next package was prepared (10/06 at 17:41, starting 10/07). Because no prepared package existed yet, the payment stayed on the old package as an overpayment. That behavior is by design.
- So she paid $750 for two packages. The second $375 almost certainly belongs to the new package, which means she should owe $0 after activation.
- Her record now shows $375 paid, not $750. There was a "Client details edited" entry today (10/14, 17:33 UTC) that may have changed it. The audit history doesn't record which fields changed, so I'll report this as unconfirmed rather than guess.

## 1. Fix the package-boundary detection
- **Root cause:** the visit-count step already lands on Emma's correct position (3 of 8). But it only reports a new package start when the "1 of N" is in the future. A "1 of N" in the past that follows an "N of N" is never reported as a start. So the dues calculation never sees that the renewal began.
- **Fix:** add a "current package started on" date. It is the most recent past, non-cancelled "1 of N" that directly follows the old package's final "N of N" in sequence. This works whether the sizes match or differ, as long as the rules below hold.
- **Rules that stay in place:**
  - A stored renewal date alone never activates anything.
  - A future "1 of N" counts only once its appointment time passes.
  - Cancelled and rebooked numbering rules are unchanged, and a cancelled "1 of 8" is never a start.
  - A stray "1 of N" that comes before the old package reaches its last visit is not a reset.
- The renewal counts as started when this date falls after the stored current package start and a prepared renewal exists.

## 2. Regression tests
1. 7/8 → 8/8 → 1/8 → 2/8 → 3/8 resolves to 3/8 on a new package, with the start at 1/8
2. A prepared 8-visit renewal activates from that boundary
3. A future 1/8 doesn't activate before its start time
4. A stray 1/8 before 8/8 doesn't reset
5. A cancelled 1/8 follows the existing boundary rules

Then run all tests and the typecheck.

## 3. Re-run the stale-renewal audit (read-only)
Covers all non-archived clients and saves a CSV in Files. For each client with a newly detected boundary:
- Old vs. corrected position
- Whether the renewal should activate
- Pending price and paid
- Current price and paid
- Master Dues before vs. after the proposed activation
- A check that total tracked dollars stay the same, flagging any client whose payment looks misallocated

## 4. Emma's two outcomes (reported, not applied)
- **If the $375 belongs to the old package:** activate, and she owes $375 on the new package.
- **If the $375 belongs to the new package** (what the evidence suggests): activate and move the 10/06 payment to the new package so it starts paid. She owes $0, with no temporary $375 debt along the way.

I'll also confirm whether today's edit reduced her amount paid.

## Technical details
- `effective-visit-state.ts`: add `currentPackageStart` to the Square state, taken from the past entries where the previous entry is the old package's final N/N. Excludes cancelled, superseded and outranked entries.
- `master-dues.functions.ts`: a renewal is `started` when there's a pending renewal and `currentPackageStart > package_start_date` (or `nextPackageStart <= now`, as today).
- The audit script is temporary and lives outside the app. Activation later goes through `renew_client_package`. For Emma's outcome B, the payment reallocation is a separate, approved data change.

## Refinement (approved)
- `currentPackageStart`: a past, live 1/N is a boundary when the **previous relevant numbered entry** is the old package's N/N. "Relevant" means after the existing sequence rules run: skip unnumbered appointments, superseded/rebooked entries and outranked cancellations. A cancelled 1/N is never a start.
- Extra tests: 8/8 → unnumbered → 1/8 → 2/8 → 3/8 detects the start, and 8/8 → non-authoritative cancelled duplicate → 1/8 keeps the boundary.
- Emma: treat the payment records as the source of truth, not her current amount paid. Report both Square payment IDs, times and amounts, where each payment was originally applied, what today's edit changed (if it can be determined), and the exact ledger after a future approved activation. No activation, no payment edits, no temporary debt.
- Audit output for every newly detected reset or stale pending renewal: detected start, effective position, current price/paid, pending price/prepaid, proposed post-activation balance, Master Dues before/after, and any suspected misallocation.
