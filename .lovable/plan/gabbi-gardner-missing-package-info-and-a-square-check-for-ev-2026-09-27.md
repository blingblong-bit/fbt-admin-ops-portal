# Gabbi Gardner — missing package info, and a Square check for everyone else like her

## What happened to Gabbi

- Her record was set up in June with nothing filled in, then archived.
- On 9/22 a new Square appointment brought her back automatically, marked as an **assessment**. Bringing her back doesn't fill in package details, so her visits, price and start date stayed blank.
- Square has since numbered her appointments **1 of 8 (9/23), 2 of 8 (9/26), 3 of 8 (9/30)**. So she clearly started an 8-visit package on 9/23. The Hub ignores those numbers because it only uses Square's numbering once a client already has a package set.
- Staff checked her in on 9/23 as "no package info", so the Hub counts 0 visits.
- Square shows no payments for her. Her 1 of 8 note has no dollar amount in it.

## Fix Gabbi (as you confirmed)

- Package: 8 visits, $375, starting 9/23, $0 paid, status active.
- Visits used: 2 of 8 (9/23 and 9/26, from Square). 9/30 stays upcoming.
- She'll show **Owes $375** and her history will get a note explaining the correction.

## Check everyone else with no package info against Square (read-only first)

64 clients who aren't archived have no package info: 27 active and 37 assessment. All of them are linked to Square. For each one, I'll look at their Square appointments over the past 6 months and the next 3:

- Find the **1 of N** that started their current package. Read its notes for a package amount and any sign it's been paid, such as "$375", "paid" or "Venmo".
- Record how far they are into the package (the latest past visit number), the start date, and any Square payments since that start.

You'll get a spreadsheet sorted into groups:
1. **Package found and amount in the note.** Includes proposed package, visits used, price, and paid or owed.
2. **Package found but no amount in the note.** Needs a price from you, like Gabbi did.
3. **No numbered appointments.** Probably genuine assessments or pay-per-visit, so leave them alone.

**Nothing on the other clients changes until you approve the list.** The ones you approve then get the same kind of correction as Gabbi, each with a history note.

## Prevent it happening again

When a client comes back from the archive or is still in assessment and Square numbers an appointment 1 of N, flag them as **Package Info Needed, Square shows N-visit package started**. The flag will show the date and note, so nobody has to find it by accident. Money won't be guessed automatically. Automatic texts stay off and nothing gets published.

## Technical notes

- A one-time data update for Gabbi: package fields, `status='active'`, `visits_used=2`, plus a `client_activities` correction row.
- The audit is a temporary read-only server route that uses the existing `loadSquareBookingIndex` and `parseVisitNote`. It returns seller and customer notes on the 1/N booking, amount and paid keywords parsed with a regex, and Square payments by customer. The route is removed afterward, and the CSV goes to Files.
- Prevention: in `needsPackageReview` / `packagePriceUnknown` (and on the dashboard and client page), show Square's detected `1/N` start when the stored `package_total_visits = 0`. This is display only, with no automatic writes.
