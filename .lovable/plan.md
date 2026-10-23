# Dashboard simplification: Collections, Renewals, New Clients

Plan only. Nothing is built until approved. Money calculations, payment allocation, renewal activation, texts and Square stay unchanged unless a phase says otherwise and you approve it.

## What exists today (confirmed by reading the code)
- **Dashboard** has about 20 tiles: Payment Due, Weekly Dues, Payment Due This Week / Next Week, Due Now / Overdue, Not Scheduled, Almost Finished, Critical, Payments Review, Payment History, Missed Check-Ins, Package Complete, Needs Renewal, Renewal Scheduled, First Visit – No Package Info, Needs Renewal Review, Needs Manual Follow-up, New Clients, Dues Texts, Visit Note Review, Visit Automation Review, All Active.
- **Menu** has Dashboard, Collections, All Clients, Schedule Check, Add Client, plus a long list of 13 more screens.
- **Money sources:** every dollar comes from Master Dues (`computeMasterDues`). Each client has three amounts: Previous (debt from an older package), Current (balance on the active package) and Renewal (the next package, with status due_now / upcoming / prepared / needs_review). Per-visit and weekly billing come from the billing simulation.
- **Three different ways of grouping by week exist today, and they disagree:**
  1. Payment Due filters (`master-dues-view.ts`): This Week / Next Week / Due Now overlap on purpose. A client can show up in two of them, and Carryover only counts per-visit and weekly billing.
  2. Weekly Dues (`weekly-dues.ts`): Expected / Carryover (last work week) / Older / Not due. These don't overlap and add up to the master total.
  3. Collections (`collections.ts`): regroups Weekly Dues into This Week / Past Due / Upcoming / Review. These don't overlap either.
- **Week boundaries:** the work week is Monday to Friday, and Saturday/Sunday count toward the next week (`work-week.ts`). Times use Chicago time.
- **Renewals:** "Needs Renewal" means a client is booked past the end of their current package. "Renewal Scheduled" means the next package is prepared and starts at check-in. A prepared renewal starts only on Square "1 of N" evidence or a package that's provably used up (`decidePreparedActivation`). The stored renewal date is only the earliest date it is allowed to start. Cancelling a prepared renewal that holds a prepayment is blocked.

## Terms we'll use
- **Due:** the money is collectible now. The package has started, or a visit or week has been billed.
- **Expected:** due money tied to a visit this week, or a renewal whose first uncovered visit falls this week.
- **Paid:** the amount covered by allocated payments. Only Master Dues decides this.
- **Carryover:** due money from last work week that is still unpaid. It's calculated live, so a payment shrinks it right away, and nothing is saved separately.
- **Older outstanding:** due money from before last week, or with no visit this week.
- **Not due yet:** prepared or future renewals, and billing after next week. These show in the master total but never in a weekly total.

## Phase 1: one Collections screen (display only)
Built on Weekly Dues items. Each dollar lands in exactly one bucket:

```text
THIS WEEK  = Expected this week + Carryover (last week) + Older outstanding
             (shown as three sub-lines; the header total is their sum)
NEXT WEEK  = only items expected next week (no older debt)
NOT DUE YET / NEEDS REVIEW = the rest
MASTER TOTAL = THIS WEEK + NEXT WEEK + NOT DUE YET + REVIEW   (difference must be $0)
```
- Separate cards for **Due now** (carryover + older) and **Master total**, labelled so nobody adds them to This Week.
- When the week rolls over, last week's unpaid items move into Carryover automatically. Nothing is stored.
- Each client shows once per tab, with one amount, one status and a link to their profile.
- Fix the Payment Due Carryover filter so it also counts package renewals that started last week. Today it only counts per-visit and weekly billing.

## Phase 2: Renewals area
- **Two lists only:** Needs Renewal (booked past the package, nothing prepared yet) and Scheduled (prepared).
- A scheduled renewal leaves the list once Square shows "1 of N" on or after the earliest date and the package actually starts. That uses the existing activation rule, unchanged.
- Rename "earliest eligible date" to **"Can start on or after"**, with help text: "This is not the start date. The package starts at the first check-in that Square numbers 1 of N."
- Cancel or undo a renewal from the client profile only. The separate tile goes away, and the prepaid-money guard stays.
- Needs Renewal Review and Manual Follow-up merge into one "Needs attention" sub-list.

## Phase 3: Dashboard and navigation
- The dashboard shows three areas: **Collections** (This Week, Next Week, Due now, Master), **Renewals** (Needs Renewal, Scheduled, Needs attention) and **New Clients** (this month, First Visit – No Package Info).
- **Admin Tools** holds every other screen: Payment Due ledger, Weekly Dues, Payment History, Payments Review, Missed Check-Ins, Visit Note Review, Visit Automation, Dues Texts, Messaging, Merge Center, Import, Notes Ledger, Backup, Sync Log, Deleted Clients and Schedule Check.
- Remove Critical, Not Scheduled and Almost Finished. Package Complete and All Active move to Admin Tools.
- The staff dashboard stays unchanged unless you approve changing it.

## Questions for you
1. **Older debt with a visit next week:** does it show under This Week (it's due now) or Next Week? Proposed: This Week only, never both.
2. **Weekend payments and visits:** do they count toward the next Monday's week, as they do now? Proposed: yes.
3. **Renewal expected next week but not started:** show it under Next Week as "Will owe"? Proposed: yes, without saying it's due.
4. **Needs Renewal:** does it trigger from bookings beyond the package, as now, or also when 1 visit is left?
5. **Staff:** should staff also get the three-area dashboard, without dollar amounts?

## Risks to watch
- Old links like `/payment-due?filter=...` and the tile links must keep working. Routes stay; only the tiles move.
- Payment Due's overlapping filters will no longer match the new tile figures. They'll be relabelled "views" so staff don't compare them to the tiles.
- Phase 1 refresh behaviour must keep working on the new screens: shared refresh after saves, Square sync watcher, "Out of date" banner.
- No database changes are needed for any phase. The only logic change is the Payment Due Carryover filter, and it's display only.

## Acceptance tests
- This Week + Next Week + Not due + Review = Master total, with a $0 difference (unit test plus a live check).
- No client dollar counted in two buckets (unit test on every item).
- Rollover test: an unpaid item expected Monday of week W shows as Carryover in week W+1 and as Older in W+2. A payment removes it at once.
- Next Week never includes older or carryover dollars.
- A renewal with a Sunday start counts toward the following Monday's week.
- A scheduled renewal stays queued before "1 of N", and leaves after "1 of N" on or after the earliest date. It's not activated by date alone or by payment alone.
- Cancelling a renewal with a prepayment is still blocked, now from the profile.
- The Payment Due Carryover filter includes Brody/Greg-type renewals that started last week.
- Each dashboard tile's figures match the screen it opens exactly.
- Existing 285+ tests and typecheck pass. Screens checked on phone and desktop. No texts, no publishing.

## Technical details
- Phase 1: add `thisWeek/nextWeek/notDue/review` grouping in `src/lib/collections.ts`, calling `computeWeeklyDues` for W and W+7. The next-week pass keeps only `expected` items, so older dollars never show twice. Update `collections.tsx`. Patch `matchesFilter('carryover')` in `master-dues-view.ts` to include `renewal.status==='due_now'` with `expected_ymd` in the prior work week.
- Phase 2: a new `/renewals` route reading the existing tile queries. Label copy goes in `PreRenewCard.tsx`. Move the cancel action into `clients.$id.tsx`. No change to `decidePreparedActivation` or `renew_client_package`.
- Phase 3: regroup tile arrays in `src/routes/_authenticated/index.tsx`, admin path only. Add an Admin Tools section in `AppShell.tsx`. Update the tile-visibility tests.
