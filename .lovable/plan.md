# Pre-publish cleanup: prepaid renewals + Square-first check-in screens

Texting stays OFF. Nothing is published. Previous-package debt is left exactly as it is.

## 1. Prepaid renewals in Payment Due
- Next-package amount in Payment Due becomes `max(0, prepared price - amount already prepaid)` instead of the full price.
- $400 renewal with $150 prepaid shows $250; fully prepaid shows $0 and does not appear as money owed.
- Clients without a prepared renewal keep today's amount (override or base price).
- Activating the renewal moves the $250 into the current balance, so the weekly total stays the same.
- Dues Text renewal amount already uses the same rule; a test locks them together.

## 2. Check-in screens follow Square
On Schedule Check, Missed Check-Ins and the client page:
- **Square synced**: show e.g. "3/8 — Square synced", last Square visit date, next numbered appointment ("Next: 4/8 — Sep 30"), and "No action required". No prominent Check In button. A small "Manual check-in" link stays for corrections.
- **Square + Needs review**: same as above plus a "Needs review" badge. No required check-in.
- **Hub fallback**: stored Hub count, "Hub fallback — Square visit notes unavailable", normal Check In button.
- **Position unreadable (automation held)**: "Square position unclear — review needed", review badge, Check In button available.
- Missed Check-Ins lists only Hub fallback and held clients as needing action; Square clients drop out of the missed list.
- No check-in records, history or check-in functions are deleted.

## 3. Rerun the acceptance test
- Remove "expected failure" marks from the 3 prepaid checks; add: $150 prepaid shows $250, fully prepaid shows $0, activation keeps the total, Dues Text amount matches.
- Rerun every earlier check (same-week 8/8 to 1/8, no double counting, Square vs Hub fallback, Needs review keeps Square, held clients stay held, no duplicate money rows).
- Safety proof: row counts, content checksums and latest update times before and after for clients, payments, client activity, dues messages, renewal campaigns, renewal messages; 0 messages, 0 campaigns; both texting switches OFF. Temporary check removed afterward.
- Full test suite and typecheck, then stop and report.

## Technical details
- `src/lib/schedule.functions.ts` (~lines 1736-1860): select `pending_renewal_paid` in both forecast queries; when `pending_renewal_price` is set, `next_package_price = max(0, pendingPrice - pendingPaid)`.
- Schedule-check / missed-check-ins rows get `visit_source`, `review_status`, `automation_usable`, effective count and next numbered booking from `effectiveStateFor` (server side, reusing the loaded Square booking index); UI branches on those fields.
- Manual check-in server functions unchanged.
- Update `src/lib/acceptance-chain.test.ts` and `weekly-payment-groups.test.ts`; update roadmap.md.
