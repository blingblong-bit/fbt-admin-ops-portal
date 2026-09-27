# Fix the duplicate Everett Tinsley

## Why there are two
- On Sep 23, Square gave Everett a new customer ID twice, about 25 minutes apart. This usually happens when duplicate customers get merged in Square. All three of his Square IDs show the same person: same name, same phone, same original sign-up date in Aug 2025.
- Every time Square announces a "new customer", the Hub only checks whether it already has that exact Square ID. It doesn't check name and phone, so it made a new Hub client each time:
  - an older record, archived since June
  - a record from 9:04 AM Sep 23, active, with no activity
  - a record from 9:29 AM Sep 23, active. This one has his Sep 23 check-in and his current appointments.
- Both active records have no package, so both show in the No Package Info tile.
- Everett is the only active duplicate like this right now (same name and phone).

## Fix
1. **Clean up Everett now**
   - Keep the 9:29 AM record, since it has his check-in and current appointments.
   - Archive the empty 9:04 AM record and note in its history that it was a duplicate caused by a Square merge.
   - Nothing about money or visits changes.
2. **Stop this from happening again.** When Square sends a new customer ID:
   - If exactly one Hub client (active or archived, not deleted) has the same first name, last name and phone, switch that client over to the new Square ID instead of making a new client. If that client was archived, bring them back. Log the switch in their history.
   - If more than one client matches, or only the phone matches but the name doesn't, make the new client but flag it for review in the existing duplicate review queue. Nothing gets merged automatically.
3. No texts are sent and nothing is published.

## Technical details
- `square.webhook.ts` customer handler: when the `square_customer_id` lookup finds nothing, look up clients by normalized phone plus case-insensitive first and last name (`deleted_at is null`). One match: update `square_customer_id` (and `status` from archived to assessment), write sync log action `relinked_merged_customer` and a client activity. Several matches, or a phone-only match: insert as today with `needs_review=true` and add a `duplicate_client_reviews` row.
- One-time data fix: archive client `31c4e835…`, keep `f2a70b0b…`, and add an activity note.
