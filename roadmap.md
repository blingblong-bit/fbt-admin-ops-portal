# Roadmap

- [x] Add shared weekly payment grouping and reconciliation logic
- [x] Build grouped This Week / Next Week detail sections and labels
- [x] Align weekly CSV export with grouped data
- [x] Add tests and verify admin-only behavior
- [x] Dues messaging workflow (drafts only, sending flag off)
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
