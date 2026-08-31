# Why Spencer Stephens and Terri Rice show no client match

## What I found

Neither name exists in the client list at all — not active, not archived, not deleted. I searched every client whose first or last name contains "spencer", "stephen", "terri", or "rice". The closest records are different people:

- Stephens: Dana, Layla, Catherine, Alyssa, Cody, Turner — no Spencer
- Rice: only Elizabeth Rice (different phone/email)
- Terri: only Terri Willis
- Spencer: Spencer Hill, Spencer Reese

There are also no pending payments or pending Square review rows for either name, so nothing is sitting in a queue waiting on you.

## Why the app can't match them

Schedule Check matches a Square booking to a client on one thing only: the Square customer ID stored on the client record. There is no fallback to name, phone, or email. So any Square customer who has never been added to the Hub (or was added without their Square ID) lands in "Unmatched Appointments" permanently.

For these two, it's the first case: they're brand-new Square customers with no Hub record at all.

## The gap worth fixing

The Unmatched Appointments card can only *link to an existing client*. When the person genuinely doesn't exist yet, there's no way to resolve the row from that card — you have to leave the page, create the client manually, come back, and link. That's why these two keep reappearing.

Proposed change: add a "Create client from this Square customer" button to each unmatched row.

- Prefills first name, last name, phone, and email from the Square customer record
- Creates the client already linked to that Square customer ID
- Leaves package fields blank so the client shows as "No package info" until staff fills it in (matching how other package-less clients behave today)
- Still shows the existing possible-duplicate warning first, so an accidental second record for someone who already exists is caught before creating

Once created, their bookings match automatically from that point on, including future payments.

## Technical notes

- Matching logic lives in `src/lib/schedule.functions.ts` (`byCustomerId` map, exact ID lookup only).
- The unmatched UI is `UnmatchedAppointmentsCard` in `src/routes/_authenticated/schedule-check.tsx`; it already fetches Square customer name/email/phone into `customer_info`, so the create form has everything it needs.
- New server function alongside `linkSquareCustomer`: insert into `clients` with `square_customer_id` set, then log a `client_activities` row noting it was created from an unmatched Square booking.
- No schema change required.

## Optional follow-up (not included unless you want it)

Add a soft name+phone suggestion to unmatched rows so a client who exists but is missing their Square ID gets flagged as a likely match instead of looking like a new person.
