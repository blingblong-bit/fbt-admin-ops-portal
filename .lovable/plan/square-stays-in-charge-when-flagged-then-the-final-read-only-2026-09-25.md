# Square stays in charge when flagged, then the final read-only acceptance test

## Part 1: Split "where the visit count comes from" from "needs review"
Each client gets two separate labels:
- **Visit source:** Square or Hub fallback
- **Review status:** Clean or Needs review
- **Automation usable:** Yes or No (shown so you can see it)

New rule:
- If Square shows a clear current visit, Square drives everything: visits, renewals, Payment Due, dues texts, and the last-visit text. This holds even when the client is flagged for review.
- The Hub is used only when Square has no usable visit number, or has one note on its own.
- Automation is held only when Square's current position genuinely can't be worked out. Examples: two different visit numbers on the latest visit date, or the latest visit going backwards with no renewal to explain it. This should be a small group.
- Old skips, a cancelled number in the middle, odd history, and unusual future numbering are **flag only**. Square still drives.

Examples:
- 6/8, then 7/8 cancelled, then 8/8 → Square at 8/8. It may be flagged, but it isn't held.
- An old skipped number, but the latest visit is clear → Square drives, flagged.
- Conflicting numbers on the latest date → Hub fallback, automation held.

Visit Note Review and Visit Automation Review stay as warning pages. Being on them no longer freezes anything. Labels on cards and the dashboard change to show the source and the review status separately.

## Part 2: Read-only acceptance test (all 16 cases in your brief)
1. **Scripted scenarios.** Each case runs through the real chain in memory: Square notes, then visit state, then renewal, then Payment Due week, then dues draft, then last-visit text.
2. **Live spot check (read-only).** Only approved audit clients are used, never Briley Taylor or Nick Smith. The check includes at least one Square-and-flagged client and one held client.
3. **Safety proof.** For clients, payments, client activity, dues messages, renewal campaigns and renewal messages, the test records before and after:
   - the number of rows
   - a checksum of every row's contents
   - the latest update time
   
   All three must match. The report also confirms 0 messages sent, 0 campaigns touched, and both texting switches OFF.

**For each case, the report shows:**
- visit source, review status and whether automation is usable
- visit position and next package start
- current, previous and next-package amounts due
- Payment Due week
- Needs Renewal and Renewal Scheduled
- whether a dues draft or last-visit text would happen
- pass or fail

**Reconciliation checks:**
- No client appears twice in the same money bucket.
- Totals add up.
- Activating a prepared renewal only moves money between buckets. The combined total stays the same.
- A payment made before sending closes the dues obligation.
- **No client whose Square position can't be worked out gets a new automated money or text decision. A review flag alone doesn't hold anything.**

**Impact:** the report re-counts the earlier numbers under the new rule. That covers Square, Hub fallback, held clients, renewal date moves, Payment Due moves, dues changes, and last-visit text qualify / stop / held. Old and new are shown side by side.

I stop after the report. Nothing is published and no texting is turned on.

## Technical details
- `effective-visit-state.ts`:
  - `source` becomes `"square" | "hub_fallback"`.
  - New `reviewStatus: "clean" | "needs_review"` comes from `detectNoteIssues` (unchanged).
  - New `automationUsable: boolean`. It is false only for a hub_fallback forced by an unreadable current position.
  - A new `currentPositionUnreadable(seq, issues)` returns true when there is a same_day_conflict on the latest past numbered date, or a backward/package_size issue whose entry is the latest past numbered visit with no N/N → 1/N boundary.
  - `suppressed` is replaced by `!automationUsable`.
  - `drivingCounts` uses Square whenever source is square.
- Callers change to read `automationUsable` / `reviewStatus`: `schedule.functions.ts` (getRenewalForecast), `visit-automation-review.functions.ts` + page, `renewal-text-eligibility.ts` (hold only when not usable; consent, opt-out and kill-switch checks unchanged), and `renewal.tick.ts`.
- Existing tests are updated. For example, "inconsistent sequence → suppressed" becomes "Square + needs_review, still drives". New tests cover the unreadable-current cases.
- Acceptance: new `src/lib/acceptance-chain.test.ts` chains `resolveEffectiveVisitState` → `drivingCounts` → `forecastRenewal` → week bucketing → `groupWeeklyPayments` → dues classification → `decideRenewalText`, with `routePayment` / `computeRenewalTransition` for the money checks. If week bucketing is inline, it's extracted as a pure function with no change in behaviour.
- Live check: a temporary admin-guarded read-only endpoint, deleted after use. For each table it records `count(*)`, `md5(string_agg(t::text,'' order by id))` and `max(updated_at)` where present. Then the full vitest suite and typecheck run.
- roadmap.md: add "Split visit source / review status" and "Final acceptance test" once building starts.
