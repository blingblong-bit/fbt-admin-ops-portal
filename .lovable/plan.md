# Prepared renewal: stored start date vs first uncovered visit (read-only investigation)

Nothing changes: no dates, packages, payments, dues rules, texts or publishing.

## What is already confirmed
- **Where the stored date comes from.** "New package starts" (the stored renewal start date) is set in the Renew Package dialog. When the renewal was prepared, it was prefilled from the client's next Square appointment, or today's date if there was none. Staff could then edit it. So it is an admin-entered earliest-eligible date, frozen when the renewal was prepared. It is not the real activation date and does not update when bookings move.
- **Payment Due / Weekly Dues ignore it for timing.** Master Dues gets renewal timing only from Square progress (boundary, then first uncovered appointment). That explains the mismatches you saw:

| Client | Stored start | Prepared on | Hub used/total |
|---|---|---|---|
| Lisa Myers | 10/14 | 10/08 | 3/8 |
| Janet Womack | 10/23 | 9/23 | 4/8 (Hub start also 10/23) |
| Angler Davis | 10/06 | 9/29 | 6/8 (no Hub start) |
| Jay Reynolds | 10/06 | 10/13 | 3/8 |
| Greg English | 10/12 | 10/06 | 5/8 |
| Brody Phillips | 10/14 | 10/06 | 5/8 |
| Abby Quick | 10/05 | 9/30 | 0/4, $100 prepaid |

- **Remaining visits are allowed.** A prepared renewal with visits left is allowed by design (pre-renew). That alone is not a bug.

## What still needs checking (not yet confirmed)
1. **Other places that read the stored date.** Check-in / Schedule Check, the Square webhook payment routing, the renewal tick, and dues text drafts all read it. Confirm whether any of them activates the renewal or routes money by that date instead of by Square progress. That would be the real early-activation risk.
2. **Whether anything already activated early.** For every client with a prepared renewal, compare these, and flag any activation, payment routing or dues text that went by the stored date before the current package was used up:
   - stored start
   - Square first uncovered appointment
   - Square visit position
   - activity history
3. **Oct 19–23 effect.** Run the same live Master Dues calculation two ways:
   - (a) as it is now
   - (b) a test version that places each renewal by its stored date

   Then list every client whose Oct 19–23 amount, week or category would differ. Confirm the current list uses (a). Expected result: no wrong inclusions, but this is unconfirmed until the run.

## Output
- Client-level CSV of every prepared renewal with these columns:
  - stored start
  - first uncovered appointment
  - Square position
  - remaining visits
  - Master Dues timing
  - Oct 19–23 amount: now vs by stored date
  - verdict: display only / record needs correction / Needs Review
- Exact root cause, affected clients, and the smallest proposed fix. Likely fix: show the Square-driven date next to the stored one, labelled "earliest eligible", and make any code path found in check 1 use Square timing. Nothing will be built until you approve.

## Technical notes
- Timing source: `renewalTimingFor` in `src/lib/master-dues.ts`.
- The stored date is written by `RenewDialog` in `clients.$id.tsx`.
- Readers to audit:
  - `schedule-check.tsx` (lines ~830, 982, 1624, 1770)
  - `square.webhook.ts:639`
  - `renewal.tick.ts`
  - `dues-messaging.ts:217-241`
- Read-only queries and a local script only.
