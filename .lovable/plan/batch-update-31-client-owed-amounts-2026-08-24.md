# Batch update: 31 client owed amounts

Apply the provided price reset list to the active client records.

## What will change

For each of the 31 named clients, on their active (non-archived, non-deleted) record:

- `package_price` → the listed dollar amount
- `amount_paid` → 0, **except** clients who took a payment today, whose current paid amount is kept

Verified against the payment timeline: **Danielle Daigle is the only client with a payment recorded today ($100)**, so her paid amount stays at $100 and she'll show $50 still owed. The other 30 reset to $0 paid.

Each updated client also gets a `notes_ledger_import` timeline entry with `guard_bypassed: true`.

## Name matches resolved

Two names don't match exactly and will map to these active records:
- "Petyton VanReenen" → Peyton VanReenen
- "Leanne Uselton" → Leann Uselton

All 31 have exactly one active record; duplicate archived records are left untouched.

## Client list and target amounts

| Client | Amount |
|--------|----------|
| Katie McNabb | $360 |
| Danielle Daigle | $150 (paid $100 today — kept) |
| Melani McKamey | $345 |
| Elizabeth Banks | $100 |
| Randy Edwards | $80 |
| Nancy Fuller | $345 |
| Greg English | $345 |
| Grayson Hill | $40 |
| Brandon Scott | $100 |
| Briley Taylor | $375 |
| Peyton VanReenen | $375 |
| Katie Prater | $375 |
| Skyler Brown | $375 |
| Keri Evans | $150 |
| Cameron Lappin | $120 |
| Katie Farrier | $375 |
| Thomas Whitley | $375 |
| Edmonia Williams | $375 |
| Landon Norwood | $75 |
| Jeremy Harbottle | $375 |
| Maddi Scott | $375 |
| Leann Uselton | $375 |
| Milli Staples | $375 |
| Charles Parish | $345 |
| Jay Reynolds | $345 |
| Cindy Stoker | $690 |
| Suzy Leahew | $50 |
| Kaysie Taylor | $60 |
| Misty Sheffield | $185 |
| Angela Pendergraff | $185 |
| Whitney Scott | $50 |

Total priced: $8,245.00. Total actually owed after the update: $8,145.00 (Danielle's $100 payment retained).

## Verification

After running the update:
- Confirm exactly 31 active records changed
- Confirm the sum of new prices equals $8,245
- Confirm every paid amount is $0 except Danielle Daigle at $100
- Confirm one timeline entry per client

## Notes

- Data-only operation; no schema or UI changes.
- Approve this plan (or switch to build mode) and I'll run it.
