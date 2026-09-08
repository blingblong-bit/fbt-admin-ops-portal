# Pre-publish verification: split debt + prepared renewals

Read-only check of the live data just now:

- 30 active clients owe money on their current package, totalling $8,020.00
- 0 clients currently carry previous-package debt
- 0 clients have a prepared (pending) renewal

So today's real numbers are unchanged by the new fields, and the two new states
(previous debt, prepared-renewal-with-no-appointment) can only be exercised with
temporary test records.

## Checks to run

### 1. Dashboard totals match expected live numbers
Compare the dashboard's Payment Due / This Week / Next Week / Overdue tiles against
the same numbers calculated directly from the data. With no previous debt on any
client, the grand total must still be $8,020.00 across 30 clients, and each client
must appear in exactly one of This Week / Next Week / Overdue.

### 2. Previous debt vs current debt, no double counting
Create one temporary test client with previous debt plus a current-package balance
and a booking this week. Confirm:
- the previous amount shows only under Overdue — Prior Weeks
- the current amount shows only under Payment Due — This Week
- Payment Due total equals previous + current, counted once
- client detail shows Previous Package Owed, Current Package Owed, Total Owed

### 3. Normal client unchanged
Take one existing client with no previous debt and confirm their tile placement,
amount owed, status badge, and client-detail money rows are identical to before
(no extra rows, no changed totals).

### 4. Prepared renewal with no appointment on mobile
Create a temporary test client with a prepared renewal and no upcoming booking.
View the dashboard at phone width and confirm the "Prepared Renewal — No Upcoming
Appointment" state reads clearly, doesn't overflow, and keeps Edit / Cancel usable.
Adjust wording or spacing if it's cramped at that width.

### 5. Typecheck / build
Run the typecheck and build after any wording or layout tweaks from step 4.

## Cleanup

Delete every temporary record and its activity rows, then confirm no test data
remains and no real client's numbers changed. Nothing is published — I'll report
results and wait for your go-ahead.

## Technical notes

- Test records use the `ZZ Test` first-name convention, removed at the end.
- Preview and live share one database, so all writes are limited to those records.
- Mobile check runs against the running app at a phone-sized viewport with a
  screenshot as evidence.
