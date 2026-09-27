# Dues: clients showing both a current package owed and a next package owed

I checked everyone who shows both amounts: **3 clients**. I compared each against Square appointments and payments. Nothing has been changed.

## Findings
| Client | Shows now | What Square shows | Correct? |
|---|---|---|---|
| Abby Quick | Current $200 owed + Next $200 owed | Finished 4 of 4 on 9/21, paid $200 on 9/4. New 1 of 4 on 9/30 | **No, counted twice.** She owes $200 once, for the package starting 9/30 |
| Kristin Luna | Current $345 owed + Next $345 owed | Finished 8 of 8 on 9/23, paid $345 on 8/19. New 1 of 8 on 9/28 | **No, counted twice.** She owes $345 once, for the package starting 9/28 |
| Keri Evans | Current $125 owed (7 visits, $325, $200 paid) + Next $325 owed (4 visits, starts 9/28) | 1 to 7 of 7 (8/19 to 9/10, note "PD $200 9/14"), then 1 to 4 of 4 (9/14 to 9/23), then 9/28 and 10/1 with no numbers | **Unclear.** The app never recorded her 4-visit package. Her 9/28 package has no visit numbers in Square |

## Why Abby and Kristin are doubled
On 9/23 their package was **renewed early**. The new package, with its future start date, 0 visits and $0 paid, became the current package. Then on 9/25 and 9/27 a **next package was also prepared** with the same start date and price. So the same package now appears in both places: once as current and once as next. A renewal text draft was also made for each.

## Fix
1. **Abby and Kristin:** cancel the duplicate prepared next package. Their current package stays as it is: $200 owed from 9/30 for Abby, $345 owed from 9/28 for Kristin. Remove the unsent renewal text draft that asked for the duplicate amount. Each change gets a note in the client's history.
2. **Prevent it happening again:** don't allow preparing a next package (or show a Needs Renewal flag) when the current package starts on or after that same date and has no visits used yet. The current package already covers those appointments.
3. **Keri Evans:** I need your answer below before I change anything.
4. Re-run the check afterwards so the list is empty, except for Keri if she's still waiting on your answer.

Texting stays OFF and nothing gets published.

## Question for you about Keri
Was her 9/14 to 9/23 "4 of 4" package paid? Should her package starting 9/28 be 4 visits for $325? If you tell me what she actually bought and paid, I'll set her current and next packages to match.

## Technical details
- For Abby and Kristin, clear `pending_renewal_*` and set `pending_renewal_paid` to 0 (it's already 0). Delete their `ready_not_sent` `renewal_due` dues_messages. Log a `pre_renewal_cancelled` activity with the reason "duplicate of current package". This is a data update, done once.
- Add the guard in the pre-renew server action and the renewal forecast (`schedule.functions.ts`): skip when `package_start_date >= uncoveredStart` and `visits_used` (effective) is 0. Add tests.
