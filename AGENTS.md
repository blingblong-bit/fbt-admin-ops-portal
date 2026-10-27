<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- `src/lib/master-dues.ts`: pure dues calculator (previous/current/prepared buckets, own status); caller supplies Square-driven renewal timing, never stored date alone — testable, stale dates harmless.
- Payment Due reads only getMasterDues/computeMasterDues (tile + /payment-due share one query); Renewal Scheduled is workflow-only — no total drift.
- pay_per_visit/weekly clients get money only from `billing-sim.ts` obligations (Square appts since `billing_effective_date`, attributable payments oldest-first) inside getMasterDues; package fields ignored — one billing path.
- `weekly-dues.ts` only slices Master Dues rows into a work week and must reconcile to its total — no drift.
- Financial corrections only via audited admin security-definer fns (`reallocate_payment`, `update_client_details`, `undo_last_renewal`) — atomic, audited.
- `payment_allocations` append-only: `original` rows + paired `transfer` rows, split = sum by bucket (mirrored in `payment-allocation.ts`); untrusted splits stay Needs Review.
- `renew_client_package` refuses repeat boundary (`last_renewal_key`) or start on/before current; fix via `undo_last_renewal`, never time windows.
- Check-in activation only via `decidePreparedActivation` (1/N or provably used-up); stored renewal date is a gate, never evidence.
- Cache refresh only via `invalidateFor(qc, event, {clientId})` in onSuccess; money screens show `DuesFreshnessBanner` (enforced by invalidation.test.ts).
- Background Square syncs reach screens only via `useSquareSyncWatcher` (polls `square_sync_log`, throttled) — refresh only, no billing logic.
- Collections (`collections.ts`) only regroups `computeWeeklyDues` into disjoint groups reconciling to Master Dues; "due now" shown inside This Week, never added — no money computed.
- Renewal forecast rows only from pure `buildRenewalForecastRows`; Square-started prepared renewal flagged `square_started_ymd` (Attention), never Scheduled.
- `/renewals` only regroups `getRenewalForecast` via `renewals-view.ts` (disjoint) and mutates only via `PreRenewCard` fns — never decides activation.
- Admin dashboard money areas use only `computeCollections`/`groupRenewals` (same as pages); other tiles under Admin Tools without dollars.
- Package edits only via audited `package_overrides` (`set_/clear_package_override`), applied at read time by `applyOverrides` (pass full rows incl. `id`); Hub tracking forced only for explicit admin visit counts or admin-started packages; verified Square 1/N promotes date/financial overrides only via `start_pending_override_from_square` (later payments over `raw_baseline`); raw fields and Square ledger never rewritten.
- Square activation decided only by `decideSquareActivation` (past live 1/N on/after prepared date, clean sequence, size match, no override), applied only by `runSquareActivationSweep` when `SQUARE_AUTO_ACTIVATION_ENABLED=true`; openers before `SQUARE_AUTO_ACTIVATION_SINCE` report-only.
- Needs Package Setup (`package-setup.ts`) is read-only; never creates packages/payments.
- Schedule follow-up lists only from `groupFollowUps`/`effectiveRemaining` (disjoint, clean Square counts preferred, Hub/Square disagreement flagged, never auto-fixed).
- Schedule worklists only from `classifyWorklist`; hides/pins in `schedule_hides`, clear only on new activity or opposite staff action; never hide mismatches/unlinked clients.
- Activation cron: `authorizeCron` checks private bearer before any work; pg_cron reads it from vault (set only by admin `syncActivationCronSecret`).
- Checkout links: amount only from Master Dues effective total (`payment-link.ts`); link payments decided only by `planLinkPayment`/`handleLinkPayment`, env-scoped (sandbox route + `is_test_fixture` clients only; production webhook sees only production rows); stale/second/mismatched payments are held for review, never auto-credited; credit via apply_square_payment. Sandbox-only until approved.
