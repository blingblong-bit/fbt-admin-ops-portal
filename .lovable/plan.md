# Square note money evidence for renewals — plan

## What the Hub does today

- **Visit numbers come from notes; money does not.** `parseVisitNote` / `readVisitNote` and `buildSequence` / `detectNoteIssues` (`src/lib/square-visit-audit.ts`) read only the `N of X` part of a note. Dates and amounts like `PD $100 9/15` are deliberately ignored so they can't be mistaken for visit counts. `liveNumbered` (`src/lib/master-dues.ts`) skips cancelled, declined and no-show bookings when working out timing.
- **Timing.** `renewalTimingFor` (master-dues.ts) and `resolveEffectiveVisitState` / `decidePreparedActivation` (`effective-visit-state.ts`) use a past `1/X` that comes after `X/X` to decide a package has started. A future `1/X` only marks it as upcoming. `buildRenewalForecastRows` (`renewal-forecast.ts`) labels a renewal that Square already started as Attention, not Scheduled.
- **Amount owed** = package price minus recorded payments. `computeMasterDues` (master-dues.ts) uses the previous, current and prepared buckets. Pay-per-visit and weekly clients go through `billing-sim.ts`. The price comes from Hub package fields, adjusted by audited overrides (`applyOverrides`, `package-override.ts`). Square notes never supply it.
- **Payments.** A payment becomes money only through `apply_square_payment` (webhook `src/routes/api/public/square.webhook.ts`, `payments.functions.ts`, `payment-routing.ts`). Splits go into the append-only `payment_allocations` ledger (`payment-allocation.ts`, `reallocate_payment`). A paid amount in a note has no effect on any balance.
- **Profile.** Appointment cards don't show the note text. Notes appear only in Visit Note Review, and only when there's a conflict.

## Rule for the new feature

A note's `$375 Due` or `$375 Paid` is **evidence, never money**. It can:
1. suggest a renewal price when the Hub has none,
2. confirm or contradict the ledger, and
3. send a client to review.

It must never create, move or clear a credit or debt by itself. That keeps "no duplicate credits" true by construction.

## Proposed implementation (preview only, in phases)

### Phase 1 — Read and show the evidence (no money effect)
- Add a pure `parseNoteMoney(note)` in a new `src/lib/note-money.ts`. It returns `{ amount, kind: "due"|"paid"|"unknown", dateHint?, ambiguous }` from forms like `$375 Due`, `$375 Paid`, `PD $100`, `Pd 375` and `375 due`.
  - Amounts need a `$` sign or a Due/Paid/PD keyword next to them.
  - Bare numbers, dates (`9/15`) and the visit fraction are never treated as amounts.
  - Two different amounts or kinds in one booking count as ambiguous.
  - When the seller note and customer note disagree, the seller note wins and the conflict is flagged, the same way visit numbers work now.
- Attach the evidence to each `SequenceEntry` and tie it to the package cycle it opens. The `1/X` booking is the main place to look. Notes on later visits in the same cycle count as supporting evidence.
- Profile appointment cards show the raw note plus a small "Note says: $375 Due" badge, with the same staff masking as now.

### Phase 2 — Compare notes with the ledger (read-only)
- Add a pure `reconcileCycleNoteMoney(cycle, ledger, effectivePackage)`. It sorts each cycle into one of these:
  - **Matches**: the note price equals the effective price, and the note's Due/Paid matches the bucket state.
  - **Price differs**: the note amount isn't the Hub price.
  - **Note says paid, no receipt**: possibly cash or Venmo. Shown as unverified; the balance is left alone.
  - **Receipt, note says due**: the note may be stale.
  - **Early payment**: a payment came in before the `1/X` date and is already recorded in the prepared bucket. The note is checked against that bucket, not the current one.
  - **Upcoming vs completed**: if the `1/X` is in the future, the cycle's evidence is labelled "expected". It doesn't change timing, the same as the current rule.
  - **Cancelled or no-show `1/X`**: the evidence is shown but ignored. If the visit was rebooked, the rebooked booking's note counts instead.
- Show the results in a new "Note vs ledger" section of Visit Note Review and as a badge on Renewals and Collections rows. Totals don't change.

### Phase 3 — Staff-confirmed actions (audited, one tap each)
- **Use note price**: opens the existing audited package editor (`set_package_override`) pre-filled with the note amount. It's for renewals with no price or `Package Info Needed`. Staff must confirm. It's never automatic.
- **Note says paid**: opens the existing manual payment flow through `apply_square_payment`, with the method (cash, Venmo, etc.) required. It runs the existing `sameAmountWarnings` and the bucket plan, so duplicates are caught.
- **Dismiss**: stored keyed on the note's content hash, so it reopens if the note is edited. This copies the existing Visit Note Review confirmation pattern.

### Edited notes and Square changes
- Each read takes a hash of the parsed money evidence for each booking. If the note changes, the reconciliation is recalculated and any dismissal expires. Nothing written earlier is changed, because nothing is ever written automatically.

### Storage (small migration)
- New table `note_money_reviews` (client_id, booking_id, evidence_hash, decision, actor, reason, created_at). It is append-only, with RLS for staff and admin, and records only explicit staff decisions.
- No table caches parsed notes; parsing happens each time notes are read, like the existing parser.

### Migration of existing clients
- No backfill writes. A one-time read-only report lists every cycle as matches, differs, paid-no-receipt, due-with-receipt or ambiguous, so the owner can work through them with the Phase 3 buttons.

## Tests
- Parser: `$375 Due`, `$375 Paid`, `PD $100 9/15` (amount 100, no date or visit confusion), `1 of 8 375`, lowercase and spacing variants, two amounts, seller vs customer conflict, a note with no money.
- Reconciliation: match; price differs; paid without receipt; early payment in the prepared bucket; future `1/X`; cancelled then rebooked `1/X`; edited note reopens a dismissal; old-cycle payment not credited to the new cycle.
- Invariants: Master Dues, Collections and Renewals totals are identical with notes on or off. No ledger rows are created by reads.

## Unknowns to confirm with you
1. Which note wordings your team actually uses (for example PD, Pd, Paid, Due, "owes", Venmo, or a payment method written in the note). I'd sample notes read-only before building the parser.
2. When the note price and the Hub price disagree, which one staff should normally trust.
3. Whether "Paid" in a note can mean a partial payment or always means the full package.
4. Whether notes on visits other than `1/X` ever carry the package amount for that cycle.
5. Whether pay-per-visit and weekly clients' per-visit `$50 Paid` notes are in scope, or only packages.

## Not changed
Square data, payments and allocations, renewals logic and activation, texts, and publishing.
