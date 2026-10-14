# Pay-Per-Visit and Weekly billing: read-only simulation

Nothing in production changes. No new fields, no client or payment edits, nothing published, no texts. Texting stays OFF.

## What gets built (simulation only)
1. A pure billing simulator that sits alongside Master Dues and does not change its rules.
   - Billing types: package, pay_per_visit, weekly. Rates are supplied by the simulator, not stored.
   - PPV: each non-cancelled Square appointment in this week or next week is its own obligation. It is Upcoming before start and Due Now after start. Later appointments are shown for information only and are not counted.
   - Weekly: one obligation per Monday–Friday billing week that has at least one appointment, whatever the number of visits. Upcoming before the week starts, Due Now once it begins. This uses the Hub's existing work-week rule, so weekends roll into the next week.
   - Cancelled visits create no charge and there is no cancellation fee. No-shows are listed as exceptions.
   - Payments go to the oldest open obligation, but only when the client, timing, amount and billing evidence all clearly point to it. If they don't, the payment is reported as "payment allocation unclear" rather than forced onto an obligation. Any excess is reported as an overpayment and never becomes credit.
   - An unclear model or rate becomes "Needs billing setup", adds $0 and is excluded from totals.
   - Additive mode: a client who is outside Master Dues today adds their simulated obligations to the total.
   - Replacement mode: when a named client's current Master Dues row exists only because the Hub treats them as a package client (for example Ava's $375), those package dollars are swapped for the simulated PPV or weekly amount. Previous debt and unrelated balances stay as they are. No one is counted twice.
2. Thirteen pure tests that cover every case in your list.

## Live audit (read-only)
- Grayson Hill, Randy Edwards, Kaysie Taylor, Suzy Leahew, Julian Marable, Nick Smith and Ava Catherine Banks. For each, I report what the Hub fields, Square appointments, appointment notes and recent Square payments suggest about the model and rate, with a confidence level.
- Your expected rates (Randy weekly $80, Kaysie $30, Suzy $50, Ava $40, Grayson PPV) are checked against that evidence. Any mismatch is reported, not overridden. Julian and Nick get a rate only if the evidence clearly supports one.
- For payments, I use Square payments recorded in the Hub, from the start of the earliest simulated week through today. Payments not linked to a client are listed as unmatched.

## Deliverables
- A CSV with the table you specified: Client, Type, Rate, Appointment/Week, Status, Amount, Payment Applied, Open, Expected, Confidence, Reason.
- A per-client summary: Current Master Dues Amount, Simulated Billing Amount, Net Change.
- Totals:
  - PPV total
  - Weekly total
  - client count
  - Due Now, This Week and Next Week dollars
  - excluded clients
  - overpayments and unmatched payments
- Reconciliation: current Master Dues + simulated open obligations = projected total, with projected client count and dollars.
- Recommended model and rate per client, plus a go/no-go on implementing before Sunday.
- All lib tests and a typecheck.

## Technical details
- New `src/lib/billing-sim.ts` (pure) and `src/lib/billing-sim.test.ts`. They reuse `workWeekStartFromYmd` and the Chicago day rule, with no imports into the UI or the dashboard.
- The audit is a one-off script under /tmp. It reads clients and square_payments plus the Square bookings index, all read-only. The output goes to /mnt/documents/billing-sim_v1.csv.
- `master-dues.ts`, `payment-due.tsx` and the dashboard stay unchanged.
