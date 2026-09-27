# James McCord and Jake McGee: findings and small fixes

## James McCord — money and visit count are right, start date is 2 days off
Square: 9/14 was 8 of 8. His new package started **9/16 (1 of 8)**, then 9/18 2/8, 9/21 3/8, 9/23 4/8. Next is 9/28 5/8.

What the Hub did:
- His $345 payment on 9/16 was held correctly for the prepared next package.
- On 9/17 staff edited his record by hand to start the new package. The prepared package (dated 9/18) was left in place.
- On 9/21 that leftover prepared package started on his **3 of 8** visit. It reset him to 1/8 and closed the hand-made package as "3/8 completed". Staff then corrected him to 4/8 on 9/23.

Where he is now: **4/8 used, $345 paid, nothing owed.** This matches Square. The only thing wrong is the package start date: Hub shows **9/18** but Square shows **9/16**.
The new rule added earlier (only start a prepared package on a Square 1/N) would have prevented the 9/21 reset.

**Fix:** change his package start date to 9/16 and add a history note explaining the mix-up. Visits and money are not touched.

(He also has an old second Hub record with no Square link, from June. It's not affecting anything and is left alone.)

## Jake McGee — correct, no change needed
He pays $50 per visit. None of his Square appointments have visit numbers (8/31, 9/4, 9/9, 9/11). The Hub handles this with back-to-back "Single Visit" packages. Each one started on the right day, and each $50 payment lines up with a visit: 4 payments, 4 visits. He shows 1/1 used, $50 paid, nothing owed. It was flagged only because his appointments have no numbers, which is expected for him.

Optional: switch him to **pay-per-visit**. Check-ins would then just record attendance, with no single-visit packages to keep renewing. Only do this if you want it; it doesn't change what he owes.

Texting stays off; nothing is published.

## Technical details
- James (client f7a1af43…): run_sql to set `package_start_date = '2026-09-16'`, and insert a `client_activities` note with source owner_approved_correction.
- Jake (c12cc7f9…): no change unless you approve pay-per-visit. That would set `payment_model = 'pay_per_visit'`, `package_total_visits = 0`, `visits_used = 0`, and add a history note. Amount paid stays as is.
