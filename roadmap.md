# Roadmap

## Simple Dues renewal week picker
- [x] Replace fixed grouping with Chicago Monday–Sunday navigation and current-week reset
- [x] Add pure weekly rows/totals, all projected 1/x starts, current-week-only already owed and read-only historical evidence (current records, not historical snapshots)
- [x] 126 focused / 697 full tests passed; 1440/390/320px unsaved examples verified current split, next/past weeks and reset without overflow/errors; build OK, unchanged balances/scheduling/data, no publication
- [ ] Signed-in real-record verification — no existing account in this draft; no account/data created under read-only instructions

## Simple Dues visit labels and upcoming renewals
- [x] Add pure read-only numbering, next renewal and weekly expected-value projections with regression tests
- [x] Show upcoming renewals on Dues and upcoming visit labels on the profile; preserve balances and scheduling
- [x] Focused/full tests and desktop/mobile unsaved-example checks (1440/390/320px); clean preview/diff; no writes or publication
- [ ] Verify actual clients signed in — this draft has no auth users; creating one or loading example rows would violate the read-only request

## Simple Dues UI cutover
- [x] Promote simple Dues totals/count; retain only Dues, Not Scheduled and New Clients tiles; remove tile customization
- [x] Replace retired navigation with Dues; retain admin-only collapsed old-screen links and move profile simple Dues first in Overview and Packages & Payments
- [x] 649 tests passed; signed-in desktop/mobile totals match ($5,860 / 22), retired links collapsed, profile order and scheduling access verified; build OK. Existing aggregate admin access retained; no scheduling/calculation/data changes or publication.

## Additive simple dues
- [x] Opening-package preview/create uses latest uncleared current override and one opening per client; missing info listed, starts on/after candidate cutover held rather than charged. Unlinked receipts shown read-only with buyer/date/amount. 646 tests passed; signed-in create/re-preview and mobile receipt checked; legacy records unchanged and cutover restored unset; build OK, no publication.
- [x] Add isolated simple tables, audited admin writes and Square payment ingestion
- [x] Add pure balance/package planner tests and separate /dues page/form/profile card/dashboard link
- [x] 627 tests passed; signed-in add/edit, notes and opening balances read back; local recorder replay/single audit/removal checked; desktop/mobile no overflow or runtime errors. Cutover restored unset; legacy diff additive only, build OK; no publication. Square attendance is not certified; live webhook delivery not triggered.

## Renewal timing boundary regression
- [x] Inspect current-cycle versus next-cycle evidence without live mutations
- [x] Exclude old completion on the effective Hub start date; hold evidence-free opener attribution for review; add 14 anonymized regressions
- [x] 160 focused / 568 full tests passed; diff checked; signed-in preview shows Melani's $345 renewal Prepared, not Due Now, without an Aug 28 expected date; no runtime errors or publication

## Assessment-to-package payment review
- [x] Add read-only Square service detection to Payment Due and Needs Package Setup without changing money calculations
- [x] 70 targeted tests passed; signed-in six-case review, profile link and mobile layout verified; build OK
- [x] Save Donna and Bristol package prices — owner-confirmed $375/8 and $200/4 saved as audited overrides; Payment Due shows both, review list down to 5

## Scheduling worklist search and Krislyn review
- [x] Add shared name search without changing category memberships or outreach state
- [x] Investigate Krislyn read-only: scheduling sees Square 3/4, forecast's explicit override sees 2/4 with two future bookings; record untouched
- [x] Signed-in desktop/mobile search, category switching and clearing verified; 42 relevant tests passed, build OK

## Client search visit progress
- [x] Match search cards/table to the profile's read-only Square visit tracking
- [x] 71 tests passed; Katie verified at 6/9 on mobile, desktop and profile without live writes

## Dues messaging saved prices
- [x] Apply active audited package overrides to queue, previews, board and single-client validation without rewriting clients
- [x] 70 targeted tests passed; signed-in Dues Texts and queue loaded read-only with sending disabled and no runtime errors

## Prepared cancellation
- [x] Atomically cancel raw preparation and prepared override without silently moving money
- [x] Clear Krislyn's prepared override through authenticated cancellation; preserve current package/history
- [x] 472 regression tests passed; signed-in cancellation and reload confirmed (no publication)

## Prepared renewal cycle correction
- [x] Correct Abby only through audited prepared override; verified published/preview Collections and Master Dues once, raw balances and receipts unchanged
- [x] Show price/prepaid/due and block ambiguous cycle reuse in shared editor/server
- [x] Full 467 regression checks and preview compilation; desktop/mobile signed-in verification without publishing (future real activation not exercised)

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
- [x] Phase 2: Renewals area (preview)
- [x] Phase 3: Dashboard + Admin Tools (preview)
- [x] Fix Renewals Needs Attention + gated Square 1-of-N activation (backlog awaiting review; enable flag + cron at go-live)

- [x] Schedule Check worklists redesign (Package Completed / Not Scheduled / Only Once / Hidden) + manual hide audit

## Scheduler web push (review only)
- [x] Home Screen metadata and push-only device onboarding
- [x] Scheduler selection and persistent scheduling follow-ups
- [x] Secure bounded checker, attempts and deduplication tests
- [x] Preview checks; leave publication and automatic alerts off
- [ ] Secure background job preparation — blocked by protected secret-storage access; no job created
- [ ] Scheduler selection, reminder window, opt-in and real iPhone test — requires publication approval and scheduler device consent
