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
- `renewalTimingFor` attributes a past Square opener only with live completion strictly after the effective Hub package start; same-day completion may precede manual renewal, and missing boundary evidence requires review rather than inferred debt.
- Payment Due reads only getMasterDues/computeMasterDues (tile + /payment-due share one query); Renewal Scheduled is workflow-only — no total drift.
- pay_per_visit/weekly clients get money only from `billing-sim.ts` obligations (Square appts since `billing_effective_date`, attributable payments oldest-first) inside getMasterDues; package fields ignored — one billing path.
- `weekly-dues.ts` only slices Master Dues rows into a work week and must reconcile to its total — no drift.
- Financial corrections only via audited admin security-definer fns (`update_client_details`, `undo_last_renewal`, `set_package_override`); `reallocate_payment`/`clear_unallocated_prepaid` remain in SQL but have no UI — atomic, audited.
- `payment_allocations` append-only: `original` rows + paired `transfer` rows, split = sum by bucket (mirrored in `payment-allocation.ts`); untrusted splits stay Needs Review.
- `renew_client_package` refuses repeat boundary (`last_renewal_key`) or start on/before current; fix via `undo_last_renewal`, never time windows.
- Check-in activation only via `decidePreparedActivation` (1/N or provably used-up); stored renewal date is a gate, never evidence.
- Cache refresh only via `invalidateFor(qc, event, {clientId})` in onSuccess; money screens show `DuesFreshnessBanner` (enforced by invalidation.test.ts).
- Background Square syncs reach screens only via `useSquareSyncWatcher` (polls `square_sync_log`, throttled) — refresh only, no billing logic.
- Collections (`collections.ts`) only regroups `computeWeeklyDues` into disjoint groups reconciling to Master Dues; "due now" shown inside This Week, never added — no money computed.
- Renewal forecast rows only from pure `buildRenewalForecastRows`; Square-started prepared renewal flagged `square_started_ymd` (Attention), never Scheduled.
- `/renewals` is a read-only regroup of `getRenewalForecast` via `renewals-view.ts`; renewal pricing is approved only from the dues screens' upcoming 1/x OK, which calls the existing audited `preRenewNextPackage` — never decides activation.
- Admin dashboard money areas use only `computeCollections`/`groupRenewals` (same as pages); other tiles under Admin Tools without dollars.
- Package edits only via audited `package_overrides` (`set_/clear_package_override`), applied at read time by `applyOverrides` (pass full rows incl. `id`); Hub tracking forced only for explicit admin visit counts or admin-started packages; verified Square 1/N promotes date/financial overrides only via `start_pending_override_from_square` (later payments over `raw_baseline`); raw fields and Square ledger never rewritten.
- Shared prepared editor uses `preparedEditGuard` on both forecast and fresh server evidence; same-cycle reschedules preserve prepaid and original preparation time, while already-opened/ambiguous prepaid cycles and active pending corrections require audited reconciliation rather than silent reuse.
- Prepared cancellation uses authenticated `cancel_prepared_renewal` to lock the client, clear raw preparation and prepared override atomically, and audit once; prepaid funds require reconciliation and active packages are never cancelled, preventing resurrection or silent money movement.
- Square activation decided only by `decideSquareActivation` (past live 1/N on/after prepared date, clean sequence, size match, no override), applied only by `runSquareActivationSweep` when `SQUARE_AUTO_ACTIVATION_ENABLED=true`; openers before `SQUARE_AUTO_ACTIVATION_SINCE` report-only.
- Needs Package Setup and the Payment Due assessment-to-training alert share the read-only `getPackageSetupList`; catalog parent service types plus live bookings identify missing effective package/pricing, never infer debt or write packages/payments, and unreadable corrections/catalog fail closed.
- Schedule follow-up lists only from `groupFollowUps`/`effectiveRemaining` (disjoint, clean Square counts preferred, Hub/Square disagreement flagged, never auto-fixed).
- Schedule worklists only from `classifyWorklist`; hides/pins in `schedule_hides`, clear only on new activity or opposite staff action; never hide mismatches/unlinked clients.
- Activation cron: `authorizeCron` checks private bearer before any work; pg_cron reads it from vault (set only by admin `syncActivationCronSecret`).
- Checkout links: amount only from Master Dues effective total (`payment-link.ts`); link payments decided only by `planLinkPayment`/`handleLinkPayment`, env-scoped (sandbox route + `is_test_fixture` clients only; production webhook sees only production rows); stale/second/mismatched payments are held for review, never auto-credited; credit via apply_square_payment. Sandbox-only until approved.
- Scheduling follow-ups use separate RLS tables and audited RPCs; they never alter classification, hides, Square or financial state. Push claims are unique per task revision/device/Chicago day, rechecked before send, with a private independent cron bearer. The messaging-only worker has no fetch/cache handlers; VAPID private keys are encrypted server-side and never returned to clients.

- Hub navigation uses one shared five-section mapping for mobile tabs and desktop sidebar so preserved detail/task links select the same section.
- Scheduling queue presentation only regroups existing Square/worklist memberships; week-scoped contact markers mean waiting, reminders are optional and retain due priority. Contact undo preserves the activity and original actor as `contacted_undone` so existing active-marker reads stay compatible.
- Schedule reads derive hide/pin reactivation without deleting stored audit state or writing sync logs; explicit staff actions remain audited writes.
- Client profile sections preserve mounted state; correction shortcuts open the existing audited package editor rather than introducing another mutation path.
- The appointments preview reuses the authenticated read-only schedule query; live display projections never enter fake client/package state, and immutable live occupancy blocks simulated actions. Only disposable in-memory fake appointments have action menus; no production mutation imports or persistence are allowed.
- Demo appointments retain package identity and history across simulated renewals; slot capacity and client overlap are checked atomically, and demo trainer creation uses the existing protected role read without creating accounts or privileges.
- One payment tracker, no credit/paid-ahead: payments go to prior debt, then the current package, never into a prepared renewal; excess stays recorded on current and goes to Payment Review (UI: "Overpaid, needs review", including any legacy stored prepared money), and renewals refuse while excess exists. Enforced in `apply_square_payment`/`renew_client_package` SQL and mirrored in `payment-routing.ts`.
- Upcoming 1/x dues rows come only from pure `upcoming-first-visit.ts` (future non-cancelled booking noted 1 of N, Mon–Sun week); shown beside, never added to, the Owes total; owed only after Square activation starts the package.
- Profile shows one Owes (`totalOwed` of the effective client); package edits use a plain form writing only the `current` override slot.
- Dues messaging queue, draft generation, board and send-time validation load effective clients through `loadDuesClients`; active audited package overrides apply read-only and correction-read failures stop validation rather than using stale raw prices.
- Client search visit progress uses the profile's raw tracking inputs and shared Square resolver in one bulk read; display projections never overwrite client fields or change financial/classification logic.
