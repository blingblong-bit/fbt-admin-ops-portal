# Fix the confirmed credit cases; audit the rest read-only

Seven clients get corrected. Nothing else is touched. Two audits are already done and reported below — no changes come out of them.

## Corrections to apply

Each change is written to the client record and logged in that client's history with a note saying what was corrected and why.

| Client | Change | Result |
|---|---|---|
| Janet Cunningham | Amount paid $400 → $200 | $200 package, paid in full, no credit |
| Analeigh Spain | Package price $175 → $375 | $375 paid on a $375 package, balance $0 |
| Deby Barnett | Package price $345 → $375 | $375 paid on a $375 package, balance $0 |
| Beau Watt | Package price $0 → $375 | Balance $0, visits stay at 5 of 8 |
| Ginger Ennis | Package price $0 → $375 | Balance $0 |
| Madelyn Shockley | Package price $0 → $345 | Balance $0 |

### Ben Quick — enter the missing renewal

He finished 8 of 8 on his $335 package and paid $200 on 8/14 toward a renewal that was never entered.

- Close out the current package as paid in full ($335 of $335).
- Start a new 8-visit package at his own price of $335, visits 0 of 8.
- Carry the $200 he already paid onto the new package, so he owes $135.
- Start date: his earliest upcoming appointment. If he has none on the books, the renewal is entered as a prepared renewal that activates at his next check-in.
- The existing $200 payment record is not deleted or duplicated.

### Not touched

Assessment-only clients (Colin Bills, Justin Mines, Maddox Liles, Sarah Vella), pay-per-visit clients (Nick Smith, Jonathan Owens, Randy Edwards), Ashleigh Johnson, Julie Heltsley, Mary Stewart, Nancy Sample.

## Audit 1 — Nick Smith's $425 (read-only, already done)

- Paid 8/20/2026 by **check, receipt #2261**, marked COMPLETED, taken on the iPhone card reader.
- Square sent no itemization — the payment carries no line items, so Square itself cannot tell us what it was for.
- His other three payments are each exactly $50 and each sits within a day of a pay-per-visit check-in (7/23, 8/6, 9/3). The $425 has no visit attached and fits no $50 pattern.
- He has only three visits on record, all pay-per-visit.

Reading: almost certainly a package purchase paid by check, not a visit fee. It cannot be proven from Square data alone. The safe next step is to look at check #2261 or ask him what was bought, then enter it as a real package. No change is proposed now.

## Audit 2 — Mary Stewart and Nancy Sample (read-only, already done)

**Nancy Sample is not a duplicate.** She has one active record and one archived legacy record that was merged into it back on 7/1. Nothing to merge or archive. Her active record now reads $375 paid on a $375 package after yesterday's correction, currently 1 of 8 visits on the package renewed 9/2.

**Mary Stewart has two genuinely separate active records**, plus one archived legacy record.

| | Record A | Record B |
|---|---|---|
| Square customer ID | DFQKDC9XZY5WW1GYDAJQH02N2C | 6ZHCWR8EYZJXBDMX1JD5MF8PH8 |
| Phone | 931-691-0522 | 931-580-5997 |
| Email | mstewart3190@gmail.com | 2stewart@charter.net |
| Package | 8-Visit, $375, paid $375 | 8-Visit, $375, paid $375 |
| Visits used | none recorded | 6 of 8 |
| Last activity | 7/1/2026 | 7/7/2026 |
| Payment history | none in Hub | none in Hub |

Both came from Square on 6/30. The old Notes record (phone 931-580-5997) was merged twice on 7/1 — once into each — which is how both ended up looking like the same person.

Important: **the two records have different phone numbers and different email addresses.** That is not the usual duplicate signature. These may be two different people, or one person with two Square profiles. Record B is the live one with real visit history; Record A has been dormant since 7/1.

Recommended next step, once you confirm: keep Record B, archive Record A, and if it is one person, move the second Square ID onto the kept record so future payments land in the right place. No merge is performed in this plan.

## Technical notes

- Price and paid corrections are single-field updates to `clients` plus an `adjustment` row in `client_activities` recording the before/after value and reason.
- Ben Quick's renewal goes through the existing renewal path so package history, the previous-package settlement, and the $200 carryover are recorded the same way a staff-entered renewal would be; `amount_paid` on the new package is set to $200 explicitly rather than carried forward silently.
- No code changes. The overpayment review flag added yesterday stays as-is and will catch future cases.
- All audit queries above were read-only against `clients`, `client_activities`, and `square_payments`.
