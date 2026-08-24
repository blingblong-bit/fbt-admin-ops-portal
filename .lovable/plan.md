# Batch update: 31 client owed amounts

Apply the user's provided price reset list to the active client records.

## What will change

For each of the 31 named clients, locate the active (non-archived, non-deleted) client record and update:

- `package_price` → the listed dollar amount
- `amount_paid` → 0

Then log a `notes_ledger_import` client activity with `guard_bypassed: true` for each updated client.

## Client list and target amounts

| Client | Amount |
|--------|----------|
| Katie McNabb | $360 |
| Danielle Daigle | $150 |
| Melani McKamey | $345 |
| Elizabeth Banks | $100 |
| Randy Edwards | $80 |
| Nancy Fuller | $345 |
| Greg English | $345 |
| Grayson Hill | $40 |
| Brandon Scott | $100 |
| Briley Taylor | $375 |
| Petyton VanReenen | $375 |
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
| Leanne Uselton | $375 |
| Milli Staples | $375 |
| Charles Parish | $345 |
| Jay Reynolds | $345 |
| Cindy Stoker | $690 |
| Suzy Leahew | $50 |
| Kaysie Taylor | $60 |
| Misty Sheffield | $185 |
| Angela Pendergraff | $185 |
| Whitney Scott | $50 |

Total: $8,245.00

## Verification

After running the update, query the affected rows to confirm:
- Exactly 31 active records were changed
- Sum of new `package_price` equals $8,245
- Each `amount_paid` is 0
- One `notes_ledger_import` activity exists per client

## Notes

- This is a data-only operation; no schema or UI changes are needed.
- If a name matches multiple active records (e.g., duplicates), the plan will be paused for clarification before applying.
