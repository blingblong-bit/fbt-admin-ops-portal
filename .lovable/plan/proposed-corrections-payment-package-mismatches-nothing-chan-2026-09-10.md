# Proposed corrections — payment/package mismatches (nothing changed yet)

Everything below is read-only findings plus a recommended fix. No client data has been touched.
All appointment data pulled live from Square (Jun 1 – Oct 15, 2026); cancelled appointments excluded from visit counts.

---

## 1. Zach Wolberg

**Now in Hub:** package start 5/18, 8 visits, price $375, paid **$0**, visits used **0**, owed $375.

**What actually happened**
- Real money: **one** Square payment, **$375 on 7/20** (completed, applied). A second "$375 recorded" entry on 9/3 was typed in by hand — there is no Square payment behind it.
- Visits after 7/20: 7/20, 7/22, 7/27, 7/29, 8/5, 8/7, 8/10 = **7 attended** (only 8/5, 8/7, 8/10 were checked in; the counter had already reached 4 before that, which lines up exactly with a package starting 7/20).
- Everything from 8/17 on was cancelled. Next appointments: **9/14 and 9/16**.
- A record edit on 9/8 wiped his paid amount and visit count back to 0.

**Recommended correction**
- Package start **7/20/2026**, 8 visits, price $375, paid **$375**, owed **$0**, visits used **7**.
- 9/14 is his 8th and final visit; 9/16 is the first visit of his next package.
- **Decision needed:** the hand-typed $375 on 9/3 — if that money was really collected, apply it as prepayment on a prepared next package (8 visits, $375, starting 9/16). If it was just ledger catch-up for the 7/20 payment, ignore it. I will not guess.

---

## 2. Suzy Leahew (pay-per-visit, $50/visit)

**Now in Hub:** pay-per-visit, price $50, paid $0, owed $50, package start dated **9/11** (future).

**What actually happened**
- Square payments: 7/23 $150, 8/7 $50, 8/21 $50 = **$250 collected**.
- Visits attended: 7/23, 7/30, 7/31, 8/7, 8/21, 8/28 = **6 × $50 = $300 charged**.
- $300 − $250 = **$50 outstanding**, which is for the **8/28** visit.
- A "$50 recorded" entry on 9/3 was overwritten seconds later by a second renewal; no Square payment exists for 9/3.

**Recommended correction**
- Amount is already right ($50 owed) — but the **start date should be 8/28/2026, not 9/11**, so the $50 shows as due now instead of next week.
- Keep pay-per-visit. Her 9/11 appointment will add another $50 when she attends.
- **Confirm:** was a $50 collected on 9/3? If yes it is missing from Hub and she owes nothing.

---

## 3. Landon Norwood

**Now in Hub:** start 7/10, 8/8 visits, price $375, paid $375, owed $0.

**What actually happened**
- Square payments: **7/31 $325** (Venmo) and **8/27 $375** (Venmo).
- Package 1: 7/10 → 7/30 = 8 visits, paid $325 on 7/31. Complete.
- Package 2: 7/31 → 8/24 = 8 visits, paid $375 on 8/27. Complete.
- He then attended **8/26** — a 9th visit, which starts a third package that was never entered.
- 8/31 and 9/2 were cancelled; he has **no upcoming appointments**.

**Recommended correction**
- Enter package 3: start **8/26/2026**, 8 visits, price $375, paid **$0**, owed **$375**, visits used **1**.
- He also needs re-booking — nothing on the calendar.

---

## 4. Livi Groce

**Now in Hub:** start 7/6, 8/8 visits, price $375, paid $375, owed $0.

**What actually happened**
- Only **one** Square payment ever: 7/6 $375. The 9/3 "$375" entry was manual ledger catch-up restoring that same payment after an earlier batch reset — not new money.
- Visits 7/6 → 7/29 = exactly 8. Nothing booked since 7/29.

**Recommended correction**
- **No financial change.** Her package is correctly complete and paid.
- She is simply dormant — no appointments in 6 weeks. Should be treated as needing re-booking / renewal, not a money fix.
- **Confirm:** if a real $375 was taken on 9/3, it needs a new package entered; Square shows nothing.

---

## 5. Ethan Brotemarkle

**Now in Hub:** start 5/4, 8/8 visits, price $345, paid $345, owed $0.

**What actually happened**
- **No Square payment record exists for him at all.** The $345 on 9/3 was entered by hand.
- Last attended appointment: **6/3**. 6/8 and 6/10 cancelled, nothing since.

**Recommended correction**
- **No change until confirmed.** Either the $345 was collected outside Square (then Hub is right), or it was never paid and he owes $345 on a package he finished in June.
- Either way he should be moved out of the active list — no activity for three months.

---

## 6. Jeremy Harbottle

**Now in Hub:** start **6/26**, 8/8 visits, price $375, paid $375, owed $0.

**What actually happened**
- Square payments: 7/1 $375 and 8/3 $375 = $750, both applied.
- Package 1: 6/26 → 7/31 = 8 visits, paid 7/1.
- Package 2: **8/3 → 8/28 = 8 visits**, paid 8/3. All eight were checked in correctly.
- 8/31 and 9/4 cancelled; no upcoming appointments.

**Recommended correction**
- Money and visit count are correct. Only the **start date is stale — should be 8/3/2026**, not 6/26, so his package history reads correctly.
- Needs re-booking / renewal.

---

## Left alone as requested
Briley Taylor and Nick Smith — read-only, no recommendation until pricing is settled.

---

# Missed check-in review (separate)

These are past, non-cancelled Square appointments with no matching Hub check-in.

### Angela Pendergraff
| Appointment | Recommend |
|---|---|
| Wed 8/12, 6:00 PM | Check In or No-Show — staff to confirm |
| Thu 8/13, 6:00 PM | Check In or No-Show — staff to confirm |
| Thu 8/27, 6:00 PM | Check In or No-Show — staff to confirm |

Note: her visit counter also jumped from 8/8 back to 5/8 on 9/9 with no renewal recorded — worth reviewing alongside these.

### Nancy Fuller
| Appointment | Recommend |
|---|---|
| Tue 8/11, 5:15 PM | Check In likely (she attends 3–4×/week) |
| Wed 8/12, 4:30 PM | Check In likely |
| Thu 8/13, 5:15 PM | Check In likely |
| Tue 8/18, 5:15 PM | Check In likely |
| Wed 8/19, 4:30 PM | Check In likely |
| Wed 8/26, 4:30 PM | Check In likely |
| Wed 9/2, 4:30 PM | Check In likely |

Because so many are missing, her visit count is understated — confirm the list before checking any in, since it changes when her package completes.

### Katie Prater
| Appointment | Recommend |
|---|---|
| Fri 8/22, 9:30 AM | Check In — this is her package start |
| Wed 8/27, 6:00 PM | Check In |
| Fri 8/29, 10:00 AM | Check In |
| Fri 9/5, 10:00 AM | Check In |

Her package also has **no start date**; it should be **8/22/2026**, with visits used **5** (8/22, 8/27, 8/29, 9/3, 9/5) once these are recorded.

### William Thomas
| Appointment | Recommend |
|---|---|
| Wed 8/12, 2:15 PM | Check In or No-Show — confirm (this was during his no-package period) |
| Thu 8/27, 2:15 PM | Check In or No-Show — confirm |
| Wed 9/9, 2:15 PM (today) | Check In if he attended |

His current package (started 9/2, $375 paid) is correct; the 8/12 and 8/27 gaps sit in the earlier un-packaged stretch and do not change his balance.

---

**Nothing will be changed until you approve, client by client.**
