# Scheduler web push — review status

## Implemented
- Home Screen manifest and FIT Hub icons; push-only standards service worker with no fetch/cache handlers or private data storage. iPhone iOS 16.4+ installation guidance and direct-tap permission request.
- Authenticated `/notifications`: own-device registration/removal, capability/permission/configuration state, deliberate own-device test, attempt status and errors. No endpoint/key material returned for another user. Admins can select only an existing non-admin staff account.
- Separate persistent follow-up tasks and audited creation/reassignment/completion RPCs. Worklist Follow up button requires explicit owner, Chicago due date/time and details. Outcomes complete tasks; OS alert dismissal does not.
- Dedicated private-bearer `/api/public/scheduling-push-tick`: at most 20 task/device attempts per invocation, five-minute durable run lease, atomic unique task-revision/device/Chicago-day claims, eligibility re-read before sending, generic payload, expired device disablement. Service acceptance is never called delivery.
- Explicit same-day Chicago reminder start/end; no default due dates or reminder window. One daily reminder per task revision/device. Failed or uncertain attempts are not automatically retried that day.
- Server-generated VAPID pair stored as encrypted private material in a service-only table; secure encryption and independent cron secrets generated/stored. Public key provisioned through the admin setup action and verified to persist.

## Applied migrations
- `0014_scheduler_push_followups.sql`: configuration, server-only keys, devices, tasks/events, attempts, staff/admin protections and claim functions.
- `0015_scheduling_push_atomic_guards.sql`: durable checker run lease, atomic device registration limits/ownership, atomic self-test rate limit.
- No changes to existing client/payment/package fields, Square/Twilio logic or scheduling classification/hiding.

## Verification
- Full suite: **459 tests / 39 files passed** (14 focused notification tests). Type check passed; automatic preview build reported build OK.
- Focused checks cover scheduler-only isolation, consent/off/missing selection, completion and future/stale revision suppression, Chicago/DST boundaries, private cron auth before work, endpoint validation, own-device self-test isolation, run overlap, and real WebCrypto encryption with mocked expired push response and disablement.
- Signed-in admin desktop and 390px phone-sized Notifications page loaded, setup-needed state shown, preview device enabling disabled, no runtime errors or mobile overflow. Public key setup persisted through reload.
- Signed-in Follow-ups page loaded empty. Worklist follow-up dialog opened; creation stayed disabled until explicit owner/due/details. No real task was submitted.
- Live preview anonymous/public-key checker requests returned 403. Valid private bearer path tested with injected dependencies, not a live push invocation.
- Database readback: zero scheduler configs, devices, tasks or attempts; one encrypted key record. Existing three cron jobs unchanged.

## Not yet verified / required before activation
- **No real iPhone subscription or notification receipt tested. No notification sent.** Must publish after review, select scheduler, choose reminder window, and have that scheduler install/open Hub and deliberately opt in/test their device.
- **No notification background job exists.** Secure paused-job preparation was refused because agent access to protected secret storage was not allowed. No workaround, cron change or partial job was applied. The dedicated checker is implemented but cannot run while nobody has Hub open until secure scheduling is completed after review.
- Persistent task create/reassign/complete UI flow and SQL permission/concurrency checks were not exercised against live data; tests cover logic/orchestration. No disposable or real client/task records created.
- Existing staff can read shared scheduling tasks/context; mutation restricted to assignee, creator or admin. Push attempt reads are own-user or admin through authenticated RLS; device rows are strictly own-user. No admin/owner automatic recipient or escalation path.
- Push provider acceptance is not device delivery/read confirmation. In-flight notifications already handed to a push service cannot be recalled by completing a task; future checker runs suppress completed tasks.

No publication, client texts, charges, financial automation changes, or active notification sending.