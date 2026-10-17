# Verification report and correction previews: Emma Sazonov, David Butner

Nothing has been written. No payment flags were cleared, no records were archived, nothing was published or texted, and Square was not changed.

## 1. Live Square payment check (read directly from Square)

| Payment | Client | Status | Amount | Refunds | Square time (UTC) | Chicago local time | Source |
|---|---|---|---|---|---|---|---|
| `JmbT…HEZY` | David | COMPLETED | $345 | none | 2026-10-01 15:32 | Oct 1, 10:32 AM | Card, own order |
| `TPXW…TUTZY` | David | COMPLETED | $345 | none | 2026-09-08 15:33 | Sep 8, 10:33 AM | Card, separate order |
| `L7zg…YhQZY` | Emma | COMPLETED | $375 | none | 2026-09-08 18:55 | Sep 8, 1:55 PM | Venmo (recorded in Square) |
| `bdW7…DkZY` | Emma | COMPLETED | $375 | none | 2026-10-06 04:44 | **Oct 5, 11:44 PM CDT** | Venmo (recorded in Square) |

- **David's Oct 1 payment** went through and has no refund. It is linked to David's own Square customer record and is a separate order and receipt from his Sep 8 payment, so it is not a duplicate. In the Hub it is logged once and was applied entirely to his current package: $0 to old debt, $0 to the prepared renewal. That's why his current package shows $690 paid against a $345 price. It is **not** applied to any other debt or package.
- **Emma's date:** Square stored her second payment as Oct 6 in UTC, which is **Oct 5, 11:44 PM** Chicago time. The correct business date is **Oct 5**.

## 2. Extra David record (and extra Melani record)
- `a0d0d064…` "David Butner" (6/02 package, $0 paid) and `fcdf41f0…` "Melani McKamey" are both already marked **archived**. Neither is linked to Square.
- Payment Due skips archived records, so neither adds any dollars. No action is needed. These were not touched.

## 3. Melani on Payment Due (live preview, signed in as admin)
Her row reads: **Renewal $345.00 · Upcoming · Expected Fri, Nov 6**, with the note "Renewal prepared after the 2026-08-28 start; next booked package 2026-11-06". She is not listed under Due Now.

## 4. Correction previews

### Emma Sazonov
Plan: keep the September package as a real history entry, then start the October package.
- **Step A:** mark the September package complete. Visits used go 4 → 8. Package start stays 9/4. Paid stays $375, which is covered by `L7zg` (9/08).
- **Step B:** start the new package through the standard Renew Package action, which permanently saves a "Package completed" history entry with the September details. New package: "8 Sessions", 8 visits, $375, starting 10/07, 4 visits used, $375 paid (covered by `bdW7`, Oct 5).

| Field | Before | After |
|---|---|---|
| Package start | 2026-09-04 | 2026-10-07 |
| Visits used | 4 | 4 (on the new package) |
| Price / paid | $375 / $375 | $375 / $375 |
| Old-package debt | $0 | $0 (September unpaid = $375 − $375 = $0) |
| Prepared renewal | none | none |

History after the change: the September package is saved as 8/8 visits, $375 price, $375 paid, start 9/4. A renewal entry is added for 10/07, plus a correction note naming both payment IDs and the Oct 5 local date.

**Master Dues: $0 → $0.**

Both original payment entries stay exactly as they are: no copies, no edits, no deletions.

### David Butner
| Field | Before | After |
|---|---|---|
| Current package paid | $690 | $345 (covered by `TPXW`, 9/08) |
| Prepared renewal paid | $0 | $345 (covered by `JmbT`, 10/01) |
| Prepared renewal start / price | 10/13 (stored) / $345 | unchanged; Payment Due still uses Square timing (10/27) |

**Master Dues: $345 (renewal, Upcoming 10/27) → $0.**

The current package is $345 − $345 = $0 owed, and the prepared renewal is $345 − $345 = $0 owed. A correction note naming `JmbT` is added.

### Effects on other records
- No other client changes.
- The number of Square payment entries and payment activity entries stays exactly the same.
- No package history is deleted; only new history and note entries are added.
- Whole-account Payment Due total drops by $345, all from David. Emma adds $0.

### Review flags (recommendation only, not applied)
- `JmbT` (David): once the move above is written and read back as $345 / $345, the payment is fully reconciled and the flag can be cleared.
- `bdW7` (Emma): once the September history entry and the October package are written and read back, the payment is fully reconciled and the flag can be cleared.
- Each flag will be cleared only if you approve that separately.

## 5. Final write (only on your explicit approval)
- One transaction per client.
- Re-check the "before" values first, and abort if anything has changed since this report.
- Read the record back afterward and confirm payment entry counts are unchanged.
