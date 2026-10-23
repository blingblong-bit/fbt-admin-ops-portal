# Roadmap

- [x] Add shared weekly payment grouping and reconciliation logic
- [x] Build grouped This Week / Next Week detail sections and labels
- [x] Align weekly CSV export with grouped data
- [x] Add tests and verify admin-only behavior
- [x] Dues messaging workflow (drafts only, sending flag off)
- [x] Dues Texts dashboard tile + one-page review/send (/dues-texts, admin only)
- [x] Acceptance-test scope: `clientIds` filter + fail-closed guard on generation
- [x] Dry-run acceptance test run with disposable ZZTEST cohort and dual baselines
- [ ] Consent acquisition workflow (0 of 1,755 clients consented) — required before any real sending

## Dues messaging — production readiness (sending OFF)
- [x] Verbal SMS consent capture + opt-out marking on the client record
- [x] One-time opt-in confirmation draft per consent event
- [x] Eligibility statuses (Consented / Not Consented / Opted Out / Invalid phone) + admin counts
- [x] Twilio send module (project secrets, Messaging Service SID, flag-gated)
- [x] Delivery-status webhook /api/public/sms/status
- [x] Inbound reply + STOP/HELP webhook /api/public/sms/inbound
- [x] Admin Send Now with fresh per-type revalidation
- [x] Conversation-style Messages tab on the client record
- [ ] Twilio secrets entered + webhook URLs configured (needs the owner)
- [ ] Controlled live test on a dedicated test phone, then flag back OFF

- [x] Visit Note Review tile + page (/visit-note-review, admin only, read-only from Square)

## Square-driven effective visit state
- [x] Resolver + tests (effective-visit-state.ts)
- [x] Nightly sweep report-only (no visits_used writes)
- [x] Wire renewal forecast / Needs Renewal / Payment Due / Dues drafts to effective state (review_required suppressed)
- [x] Visit Automation Review page + tile
- [x] Read-only impact report (incl. dues gained vs removed/moved) — stop before publishing
- [x] Renewal reminder texts job on effective state + consent/opt-out guards + kill switch (OFF) + dry-run report
- [x] Split visit source / review status (review flag no longer freezes Square)
- [x] Final read-only acceptance test (16 cases + reconciliation + checksums)
- [x] Payment Due nets money already prepaid toward a prepared renewal
- [x] Check-in screens follow Square (manual check-in only for Hub fallback / unclear position); Missed Check-Ins excludes Square-synced clients
- [x] Acceptance rerun after prepaid + check-in changes
- [ ] Turn on RENEWAL_AUTO_TEXT_ENABLED — only after you review the report, post-publish
- [ ] Publish — waiting on your go/no-go

## Visit Note Review follow-ups
- [x] Rebooked/renumbered cancellations no longer flag (Charles Parish)
- [x] "This is correct" button (expires when Square bookings change) + Show confirmed / Undo
- [x] Refresh reads Square fresh; review pages hold data 1 minute

## Master dues (Payment Due as master list)
- [x] Read-only dry run + CSV
- [x] v2 dry run (timestamp + assessment rules)
- [ ] Angler Davis: cancelled 8/8 counted as current position (needs approval to fix)
- [ ] UI change: waiting on owner comparison against Notes

## Billing types (PPV / weekly)
- [x] billing_type / rates / effective date; Randy, Suzy, Grayson, Kaysie set
- [x] Payment Due + tiles include PPV/weekly obligations; Carryover filter
- [ ] Ava Banks, Julian Marable, Nick Smith billing model (needs owner decision)

## Weekly Dues
- [x] Oct 19–23 collection list with held accounts (read-only CSV)
- [x] Pure weekly module, /weekly-dues page, dashboard tile, Oct 19–23 read-only preview
- [ ] Publish (waits on owner approval)

## Admin workflow improvements (pre-launch)
- [x] Manual payment method/note + Square ref duplicate block + 3-day same-amount warning
- [x] Payment allocation ledger (original vs transfer) + safe reallocation (admin)
- [x] Prepaid corrections via reallocation
- [x] Billing type/rate/effective date editing (admin)
- [x] Before/after edit history
- [x] Boundary-aware renew-twice block + Undo last renewal
- [x] Tests + e2e with temporary test clients; GO/NO-GO

## Prepared-renewal check-in activation
- [x] Read-only check: past activations, current exposure, Oct 19–23 recheck, CSV
- [x] Check-in activates only on 1/N or a used-up package; unclear → held, no visit taken
- [x] "Earliest eligible start" vs Square expected renewal labels; tests
- [ ] Publish (waits on owner approval)

## Phase 1 — stale data (preview only)
- [x] Shared invalidateFor + wire all save points
- [x] Updating / Out of date indicators on money screens
- [x] Tests + coverage check
- [ ] Phase 2 Collections redesign — waiting on approval

## Dashboard simplification (plan approved)
- [x] Phase 1: single Collections screen (This Week incl. due now, Next Week new-only, Not Due, Review, Master)
- [ ] Phase 2: Renewals area (waits for approval)
- [ ] Phase 3: Dashboard 3 areas + Admin Tools (waits for approval)
