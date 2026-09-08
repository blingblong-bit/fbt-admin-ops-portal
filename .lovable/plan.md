# Needs Renewal rule — simulation report (no changes made)

Read-only test against live client data and live Square bookings, run 09/08/2026. Nothing was modified: no code, no database rows, no schema, no UI.

Rule tested: `remaining = total visits - visits used`. Upcoming non-cancelled appointments are sorted in time order; the next `remaining` of them are covered by the current package; a client qualifies if at least one upcoming appointment falls beyond that.

## Clients who qualify (15)

| Client | Used / Total | Remaining | Upcoming appts | Appointment dates (in order) | First uncovered | Projected new package start |
| --- | --- | --- | --- | --- | --- | --- |
| Angela Pendergraff | 8/8 | 0 | 3 | 09/08 6:00p, 09/10 6:00p, 09/16 6:00p | #1 09/08 6:00p | 09/08/2026 |
| Emma Carroll | 8/8 | 0 | 3 | 09/08 5:15p, 09/09 3:00p, 09/11 3:00p | #1 09/08 5:15p | 09/08/2026 |
| Nancy Fuller | 8/8 | 0 | 2 | 09/08 5:15p, 09/10 5:15p | #1 09/08 5:15p | 09/08/2026 |
| Leann Uselton | 8/8 | 0 | 2 | 09/08 4:30p, 09/09 4:30p | #1 09/08 4:30p | 09/08/2026 |
| Jake McGee | 1/1 | 0 | 1 | 09/09 5:15p | #1 09/09 5:15p | 09/09/2026 |
| Abby Quick | 4/4 | 0 | 1 | 09/09 9:45a | #1 09/09 9:45a | 09/09/2026 |
| Jeanie Luna | 8/8 | 0 | 1 | 09/09 11:15a | #1 09/09 11:15a | 09/09/2026 |
| Sara Elliot | 7/8 | 1 | 2 | 09/08 9:45a, 09/10 9:00a | #2 09/10 9:00a | 09/10/2026 |
| Kristin Breyette | 7/8 | 1 | 2 | 09/08 11:15a, 09/10 11:15a | #2 09/10 11:15a | 09/10/2026 |
| Jay Reynolds | 7/8 | 1 | 4 | 09/09 4:30p, 09/11 3:45p, 09/16 3:45p, 09/18 3:45p | #2 09/11 3:45p | 09/11/2026 |
| Lisa Myers | 7/8 | 1 | 7 | 09/09, 09/14, 09/16, 09/21, 09/23, 09/28, 10/01 (all 3:45p) | #2 09/14 3:45p | 09/14/2026 |
| Brett Ferrell | 7/8 | 1 | 3 | 09/10 5:15p, 09/14 5:15p, 09/17 5:15p | #2 09/14 5:15p | 09/14/2026 |
| Angela Bell | 7/8 | 1 | 4 | 09/09, 09/16, 09/23, 09/30 (all 5:15p) | #2 09/16 5:15p | 09/16/2026 |
| Danielle Daigle | 2/4 | 2 | 6 | 09/08 11:15a, 09/10 11:15a, 09/15 10:30a, 09/17 9:45a, 09/22 9:45a, 09/24 10:30a | #3 09/15 10:30a | 09/15/2026 |
| Justin Henderson | 4/8 | 4 | 7 | 09/08, 09/10, 09/15, 09/17, 09/24, 09/29, 10/01 | #5 09/24 5:15p | 09/24/2026 |

Total qualifying: **15**.

## Comparison with the current Needs Renewal tile

Current rule: visits remaining = 0 AND any booking in the next 30 days.

Currently listed (7): Angela Pendergraff, Emma Carroll, Nancy Fuller, Leann Uselton, Jake McGee, Abby Quick, Jeanie Luna.

Would be added (8): Sara Elliot, Kristin Breyette, Jay Reynolds, Lisa Myers, Brett Ferrell, Angela Bell, Danielle Daigle, Justin Henderson.

Would drop off: **none** — every currently listed client still qualifies under the new rule.

## Things to validate before implementing

- Danielle Daigle (2/4) and Justin Henderson (4/8) qualify only because they booked far ahead — the new rule surfaces them weeks before their package actually ends. Decide whether to flag them now or only within a horizon (e.g. first uncovered appointment within 14 days).
- Scan window used here was the next 90 days of bookings; the live tile only looks 30 days ahead. A wider window is part of what makes the new rule flag more people.
- Clients with no visit tracking (visits used blank) and pay-per-visit clients were excluded from the simulation.

## Next step

Confirm the list above is right. Once you approve the rule (and whether to bound the look-ahead), the implementation would replace the tile's remaining-visits-only check with the appointment-coverage comparison — no schema change needed.
