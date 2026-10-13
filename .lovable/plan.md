# Master Dues follow-up: findings and two small rule fixes

Everything below was read live from Hub and Square, read-only. Nothing was changed.

## Findings per client

**Colson Ray: no bug in the money, status changed today**
- Fields: 8 visits, $375 price, $0 paid, 0 used, package name blank. Square has 1 of 8 booked 10/15 11:15 AM and 2 of 8 on 10/22.
- At dry-run time his status field was "assessment", so the rule "skip anyone marked assessment" left him out. At 3:36 PM Hub automatically restored him to Active because of his new Square appointment, so he now qualifies: $375 current balance, Due now, expected this week.
- Rule fix: a price alone doesn't count. An assessment-status client is included only with clear evidence of a real package: a priced package of more than one visit and/or numbered Square package appointments (like 1 of 8). True assessment-only clients stay excluded. Today this changes nothing beyond what his restore already did, but it stops the same thing happening to the next client in his position.

**Nancy Fuller: stale Notes only**
- Current package $345, fully paid. Square shows 7/8 used, then 8/8 cancelled 10/12, then 1 of 8 today at 5:15 PM (22:15 UTC).
- Prepared renewal: $345 price, $345 already paid (her 9/29 Square payment went onto it). New-package balance = $0.
- Hub is right not to show money for her. No earlier payment is wrongly hiding it, because she really did prepay.

**Dan Giffin: stale Notes / data cleanup**
- Live record: $265 price, $265 paid, nothing from earlier packages, no renewal. Square has 7 of 8 booked on 10/15. Hub balance = $0.
- The $10 only exists on his archived duplicate ($265 price, $255 paid), which was merged in July. A July ledger reset also briefly set his price to $10.
- Hub can't calculate the $10 from his live record. You need to decide whether he really owes $10. If he does, it has to be entered on the live record.

**Pay-per-visit (5): no dependable per-visit rate exists**
- In Hub the per-visit rate is stored in the package price box, and that box means different things for different clients:
  - **Grayson Hill:** $40 in Hub. His last Square orders were in 2021, at $30. Booked 10/14.
  - **Randy Edwards:** $80 in Hub. Square orders are a weekly $80 "Special Package", sometimes $53.34. He visits about 3 times a week, so $80 is not per visit. Booked 10/13, 10/14 and 10/15.
  - **Kaysie Taylor:** $30 in Hub. No Square orders. Booked 10/14.
  - **Suzy Leahew:** $50 price, $50 paid in Hub. Square shows $50 "Single Visit" orders. Booked 10/16. Her other "2-Visit" record is already deleted, so it isn't counted.
  - **Julian Marable:** $100 price, $100 paid in Hub. Square shows a mix of $100 and $50 orders. Nothing booked.
- Square appointments don't carry a price, so they don't help.
- Smallest clean change, for later approval: add a "per-visit rate" box and a "billing" choice (per visit or weekly). Until then, these clients stay on the exceptions list.

**Charles Parish: correct, and the dry run predates his renewal**
- Square: 7 of 8 today at 4:30 PM, 8 of 8 on 10/15, then a visit on 10/20 with no note, then 2 of 8 on 10/22. His prepared $345 renewal starting 10/20, unpaid, was created at 3:28 PM, after the dry run.
- Re-run, he shows $345, Upcoming, expected 10/20. That 10/20 date comes from his 8/8 finishing on 10/15, not from the stored date.

## Real logic bug found: same-day appointments called overdue
The dry run marked a renewal Due now if the first uncovered appointment fell on today's date. It should compare the actual appointment time with the current time instead. Affected today:
- Lailar Logan, $345: 1 of 8 at 3:45 PM
- Katelyn Sanborn, $345: 1 of 8 at 3:45 PM
- Debbie Renner, $345: 1 of 8 at 6:00 PM
- Angler Davis, $375: Square shows 7 of 8 at 5:15 PM today, not 1 of 8. I'll check why her forecast lands today.

These clients stay Upcoming until the appointment start time passes. This changes status only, not dollars.

## Summary
- **Real logic bugs:** the same-day time comparison, and the assessment rule (small rule change).
- **Stale Notes only:** Nancy Fuller, plus Charles Parish and Colson Ray, whose records changed after Sunday.
- **Data cleanup:** Dan Giffin's $10 (owner decision), and Angler Davis if the check shows a record problem.
- **Needs a new field later:** the 5 pay-per-visit clients.
- **Revised proposed total:** about 38 clients and $11,972.50. That is the earlier $11,252.50, plus Charles $345 and Colson $375 from today's record changes. The time fix only moves dollars between statuses. Exact figures come from the re-run.

## What I'll do once approved
1. Change the renewal timing to compare the appointment's actual start time with now.
2. Change the assessment rule: include an assessment-status client only when a priced package of more than one visit and/or numbered Square package appointments show a real package. Keep pay-per-visit clients as exceptions and leave Dan Giffin's record alone.
3. Add tests for both.
4. Check Angler Davis's forecast.
5. Re-run the read-only dry run and save `master-dues-dry-run_v2.csv`. I'll report the exact counts and dollars, including which clients moved between statuses.
6. Run the tests and type check.

No publishing, no record changes, texting stays off.
