# Fix Charlie Nichols and clients who join Square mid-package

## What's wrong
- Square shows Charlie at **5 of 8** (Sep 24), **6 of 8** (Sep 29) and **7 of 8** (Oct 1).
- In the Hub he's marked **Assessment**, with a $345 price and $345 paid, but **0 total visits** and no start date.
- The Hub only uses Square numbers when a client already has a visit count set up, so his upcoming appointments show no visit numbers.
- The new automatic package fill didn't help him. It only fills a package when it can find the **1 of 8** visit in Square. Charlie's visits start at 5 of 8 because his earlier visits happened before the Square history the Hub reads, so he was just flagged instead of filled.

## Fix
1. **Fill packages that start partway through.** If a client's Square notes run in order (like 5, 6, 7 of 8) and all show the same package size, fill in:
   - total visits (8)
   - visits used so far (the last past visit, so 5 for Charlie today)
   - the first date we have as the package start, marked **"start date estimated"** for staff to check
2. **Keep price and payment already in the Hub.** Charlie's $345 price and $345 paid stay as they are. "Price Needed" only shows up when the price is blank.
3. **Change Assessment to Active** when a package gets filled from Square notes like this.
4. **No texts and no money changes.** No renewal or dues messages go out, and every change is logged in the client's history. Mixed-up or out-of-order notes still go to manual review.
5. **Fix Charlie right away** once this is built. Other clients in the same situation get fixed the next time the dashboard opens or the nightly check runs.

## Technical details
- `packageAutofillFromBookings` (effective-visit-state.ts): when there's no 1/N anchor, accept a coherent run of increasing numbers with the same N. `visitsUsed` = highest past number. `startDate` = earliest noted booking date. Return `startEstimated: true`.
- `package-autofill.server.ts`: don't overwrite a non-zero `package_price` or `amount_paid`. Set `status='active'` when it's currently `assessment`. Add "(start date estimated)" to the activity text. Flag for review only when the price is 0 or the start date is estimated.
- Add tests for a mid-sequence run (5, 6, 7 of 8), a gap or out-of-order run (rejected), and mixed package sizes (rejected).
