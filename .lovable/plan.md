# Scheduler notifications — first version

## Build
- Add Home Screen app name, icons and manifest, plus a push-only service worker that never caches pages, API responses or client data.
- Add staff Notifications settings with installation guidance, capability/permission/device states, explicit enable/disable and a deliberate self-test.
- Let admins select an existing staff scheduler. Default to no scheduler and automatic notifications off; no owner/admin subscriptions or Dad escalation.
- Add persistent scheduling follow-ups with explicit owner/due time, completion outcome and authenticated task links. Add a follow-up action to existing worklist rows without changing classification or hiding.
- Add a separately authorized, bounded server checker with atomic deduplication, generic alert text, visible attempt/errors and expired-device cleanup. Keep its job inactive pending review, scheduler selection and device consent.

## Technical details
- Reuse existing staff/admin authorization and private-cron authorization patterns; isolate notification tables and functions from financial and Square logic.
- Generate Web Push signing keys server-side and store private material in a server-only protected backend record; use a separate securely generated cron secret.
- America/Chicago reminder windows are explicit settings. Due dates are staff-entered; alerts never complete tasks.
- Test authorization, recipient isolation, duplicate runs, completion suppression, cleanup and preview desktop/mobile settings. A real iPhone delivery requires a published version and an opted-in device and will be reported as untested here.

## Review boundary
No publication, real client/payment changes, client messages, charges, financial automation changes or active notification job. Existing unrelated roadmap blockers remain unchanged.