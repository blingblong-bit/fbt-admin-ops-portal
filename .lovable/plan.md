# Convert the automatic "last visit" renewal text to the effective visit resolver

Chosen option: convert, not disable. If the impact report looks wrong, the fallback is a single switch that turns this texting path off for the release.

## What changes

The automatic renewal text job (runs every 15 minutes) currently decides "on last visit" from the stored Hub count (`visits_used == total - 1`). It will now use the same visit resolver as the rest of the Hub:

- **Square synced** → last visit means the Square position is total − 1 (for example, 7/8 done) and the next numbered future appointment is N/N. The "last visit date" in the text becomes the date of that N/N appointment, not simply "the next booking".
- **Hub fallback** → stored Hub count, exactly as today (including today's "needs 2 upcoming bookings" rule).
- **Review required** → no automatic text. Logged as held and shown on Visit Automation Review.

The auto-clear step, which closes an open campaign once a client has renewed, also uses the resolved position. For Review required clients, open campaigns are left exactly as they are: no auto-clear and no follow-ups.

## Checks that stay the same

Balance owed must be 0; a phone number and a linked Square customer are required; there is no duplicate campaign for the same package; follow-ups #2 and #3 go out only in the 10am–noon clinic window, once per day, and never after a reply; the message wording and sending number stay the same.

## Gap found (needs your decision)

This job does **not** check SMS consent or opt-out today. It sends even if the client texted STOP. I plan to add both: consent is required, and any opt-out blocks the text. This applies to new campaigns and follow-ups, using the same consent and opt-out fields the Dues Texts page uses. The impact report will count how many clients this blocks.

## Read-only impact report (runs before publishing)

This is a dry-run version of the eligibility logic. It shares the decision code with the live job, but it has no send and no write code at all.

- Clients who qualify today (stored count) and under the new logic
- Newly qualify / stop qualifying (with names and the reason for each)
- Suppressed for Review required
- Blocked by the new consent/opt-out check
- Open campaigns whose auto-clear or follow-up outcome would change
- Confirmation: 0 messages sent and 0 campaign or message rows written. This is verified by counting the campaign and message tables before and after the run.

Stop after the report. No publishing until you give the go-ahead.

## Technical details

- Extract a pure function `decideRenewalText(client, effectiveState, upcoming, existingCampaign, consent)` → `{ eligible, reason, lastVisitYmd }`. Both `renewal.tick.ts` and the dry run call it.
- In `renewal.tick.ts`, load the index once with `loadSquareBookingIndex` and use `effectiveStateFor`. Use `drivingCounts` for the Hub path; if `source === "review_required"`, skip the client.
- Add a kill switch: `RENEWAL_AUTO_TEXT_ENABLED` env. If it is not set to `"true"`, the job skips sends and campaign creation. The default for this release is decided after the report.
- Unit tests cover: Square 7/8 with a future 8/8 → eligible; Square 8/8 → not eligible; review_required → suppressed; opted out → blocked; Hub fallback unchanged.
- The dry run is admin-only and read-only. It uses a server function or a temporary endpoint, which is deleted after use.
- Update roadmap.md.
