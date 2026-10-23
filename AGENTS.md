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

- `src/lib/master-dues.ts` is the pure master-dues calculator (previous / current / prepared-renewal buckets with separate status); renewal timing is supplied by the caller from Square-driven progress, never from the stored renewal date alone — keeps money logic testable and stale dates harmless.
- Payment Due reads only from getMasterDues/computeMasterDues (dashboard tile and /payment-due share one query); Renewal Scheduled is workflow-only — prevents total drift.
- Clients with `billing_type` pay_per_visit/weekly get money only from `src/lib/billing-sim.ts` obligations (Square appointments since `billing_effective_date`, clearly attributable payments oldest-first), computed inside getMasterDues; package fields are ignored for them — one billing path keeps Payment Due and tiles consistent.
- `src/lib/weekly-dues.ts` slices Master Dues rows into one work week (expected / carryover / older / not-due); it never computes money itself and must reconcile to the Master Dues total — keeps Weekly Dues and Payment Due from drifting.
- Financial corrections (payment moves, price/paid/billing edits, renewal undo) go only through security-definer DB functions (`reallocate_payment`, `update_client_details`, `undo_last_renewal`) that check admin role and log before/after — keeps money edits atomic and audited.
- `payment_allocations` is append-only: per payment, `original` rows (reconstructed once from the payment activity's `applied_to_*`) plus paired `transfer` rows; current split = sum by bucket. Rules mirrored in `src/lib/payment-allocation.ts` — payments whose split can't be trusted stay Needs Review.
- `renew_client_package` refuses a repeat of the same boundary (`clients.last_renewal_key`) or a start on/before the current start; mistakes are fixed via `undo_last_renewal`, never by time windows.
- Prepared-renewal activation at check-in goes only through `decidePreparedActivation` (effective-visit-state.ts): 1/N or provably used-up package; the stored renewal date is an earliest-eligible gate, never evidence — prevents early activation on missing numbers or failed lookups.
- Post-mutation cache refresh goes only through `invalidateFor(qc, event, { clientId })` in `src/lib/invalidation.ts`, called from onSuccess; money screens show freshness via `DuesFreshnessBanner` — one event map stops stale dues from per-screen key lists (enforced by invalidation.test.ts).
- Background Square syncs reach open screens only via `useSquareSyncWatcher` (polls latest `square_sync_log`, throttled, calls `invalidateFor(..., "square-sync")`) — cache refresh only, never billing logic.
- Collections Hub (`src/lib/collections.ts`, /collections) only regroups `computeWeeklyDues` items into disjoint groups (this week, due now, next week, not due, review) that must reconcile to the Master Dues total; "due now" is shown inside This Week, never added to it, and next week holds only new items — it never computes money, keeping the front-desk view from drifting.
- Renewals page (`/renewals`) only regroups `getRenewalForecast` rows via `src/lib/renewals-view.ts` (Needs Renewal / Scheduled / Needs Attention, disjoint) and mutates only through `PreRenewCard` server functions — it never decides activation, so renewal rules stay in one place.
- Admin dashboard primary areas (`src/components/AdminDashboard.tsx`) derive numbers only from `computeCollections` / `groupRenewals`, the same functions their destination pages use; other tiles live under Admin Tools without dollar amounts — prevents dashboard/page total drift and duplicate money tiles.
- Admin package edits go through `package_overrides` (one active row per client+slot, set/cleared only by admin security-definer `set_package_override` / `clear_package_override`, audited in client_activities) applied at read time by `applyOverrides` (src/lib/package-override.ts) everywhere packages are read (getMasterDues, getRenewalForecast, client profile), forcing Hub visit tracking and adding post-override check-ins via `baseline_visits_used`; raw client fields and the Square ledger are never rewritten, and an active current/pending override makes `decidePreparedActivation` hold — keeps admin figures authoritative without fabricating payments.
