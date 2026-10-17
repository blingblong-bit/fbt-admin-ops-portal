# Admin workflow readiness check: results and proposed fixes

I checked each action against the screens staff use today. Nothing was changed, nothing was texted, nothing was published.

## Results

| # | Workflow | In Hub now | Where staff do it | Keeps history? | Risk |
|---|---|---|---|---|---|
| 1 | Edit package price, start date, size, visits used | **Yes** | Client page, then Edit Client | Partly. The note only says "Client details edited" and doesn't record the old or new values | Low |
| 2 | Finish an old package and start a new one | **Partial** | Client page, then Renew Package. Can also prepare one ahead (Prepare next package) | Unpaid money moves into "previous package owed". The old package is kept only as a history note. There is no package history list | Medium. Pressing Renew twice duplicates the debt (this is what happened to Hunter) |
| 3 | Record a manual payment (Venmo or cash) | **Partial** | Client page, then Record Payment | Yes, with its own ID, and a retry can't record it twice | **High.** There is no way to mark it Venmo or cash, or add a note. If staff also enter the same payment in Square, it gets counted twice, and nothing warns them |
| 4 | Move a payment from the current package to a prepared renewal (or back) | **No** | Only by hand-editing "amount paid" in Edit Client. The prepared renewal's paid amount can't be edited at all | No | **High.** This is how Keri ended up showing $50 owed. It needed a database edit for David |
| 5 | Edit a prepared renewal's date, size or price, or cancel it | **Partial** | Client page, then the prepared package card, then Edit or Cancel | Yes, with a history note | The prepaid amount can't be edited |
| 6 | Change billing type (package, pay-per-visit, weekly, assessment) | **No** | Not on any screen. Edit Client only has an old package / pay-per-visit switch, which Payment Due doesn't use | Not applicable | **High.** Pay-per-visit and weekly rates and start dates can only be set through a database edit |
| 7 | Review correction history and payment notes | **Partial** | Client page, then Activity. Also the Payment History page | Payments: yes. Edits: no before and after values | Medium |
| 8 | Edits update Payment Due and Weekly Dues | **Yes** | Both pages use the same calculation and refresh within about a minute (or with Refresh) | Not applicable | Low |

**Renewal-timing fix:** yes, it's in the version that would be published. Publishing sends the current code, and its tests are included and pass (Melani shows Upcoming 11/6).

## Recommendation: NO-GO for now
The money totals are trustworthy. But staff can't yet fix the most common mistakes (items 3, 4 and 6) on their own. Without those fixes, they would either get balances wrong or need someone to edit the database.

## Proposed fixes (I'll build these only if you approve; launch after them would be GO)
1. **Record Payment:** add a required method (Venmo, cash, check, other) and a note. If Square already has a payment for the same amount within 3 days, show a warning: "Square may already have this payment".
2. **Move payment:** a new admin-only action on the client page that moves an amount between previous package owed, the current package and the prepared renewal. It can't move more than was paid and keeps the total the same. Each move adds a detailed history note.
3. **Prepared renewal:** add a "prepaid amount" field to the existing Edit form.
4. **Billing type:** add an admin-only section to Edit Client with billing type, rate and start date. It warns that pay-per-visit and weekly billing ignore the package fields.
5. **Edit history:** Edit Client and these new actions record before and after values in the Activity list.
6. **Renew safety:** block a second Renew within 10 minutes for the same client unless the admin confirms.
7. **Checks:** add tests for the payment move (total unchanged, can't go below 0), the duplicate warning and the billing-type save. Then run the full test suite and code check, and confirm one client end to end in the browser using fake test data only (no real clients).

## Technical details
- New server functions with requireSupabaseAuth plus an admin role check: `reallocatePayment` (one update that keeps the sum of `previous_package_owed` reduction, `amount_paid` and `pending_renewal_paid` the same) and `updateBillingType`. The manual payment gets `method` and `note` stored on the `square_payments` row (`note` column already exists), with the method added to the manual payment ID prefix.
- The duplicate warning reads `square_payments` for the client and only warns. It never blocks or merges.
- Payment Due and Weekly Dues logic is unchanged.
