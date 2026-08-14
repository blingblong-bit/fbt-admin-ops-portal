# Renew Package: auto start date + correct Payment Due week

Two focused changes. Needs Renewal detection, Square sync, payments, and visit history stay exactly as they are.

## 1. Prefill Start Date from the next Square appointment

Today the Renew Package dialog prefills Start Date with the date the button was clicked.

Change: when the dialog opens, look up the client's earliest upcoming Square appointment (using the existing per-client appointment lookup already used elsewhere on the client detail page) and prefill Start Date with that appointment's clinic-local date.

- If no upcoming appointment is found (or Square is unavailable), fall back to today's date exactly as now.
- The field stays fully editable before confirming.
- A small hint under the field notes the date came from the next appointment, so staff know why it's set.
- No change to package name, visits, price, paid-today, or what the renewal writes.

## 2. Payment Due week follows the new package start, not the click date

Payment Due — This Week / Next Week are already driven by Square bookings, not by when staff clicked anything. The misleading case is a client who finished their package earlier in the same week: that completed visit is still a booking in this week, so a freshly renewed unpaid package shows under This Week.

Change: when a client has a package start date in the future, that start date decides the bucket instead of leftover bookings from the current week.

- Start date falls inside the current work week (or is in the past/empty) → behaves exactly as today.
- Start date falls in next work week → counted only under Payment Due — Next Week, excluded from This Week and from Overdue — Prior Weeks.
- Start date falls beyond next week → not counted in either weekly tile; still appears in the plain Payment Due list.

Everything else about the tiles, totals, exports, and badges is unchanged.

## Resulting behavior

- Enters Needs Renewal: visits_used >= package_total_visits (visits remaining = 0, package has visits) AND an upcoming Square booking exists. Unchanged.
- Prefilled date: the earliest upcoming Square appointment date for that client; today only as fallback.
- Leaves Needs Renewal: as soon as Renew Package resets visits_used to 0, so remaining visits are no longer 0.
- Unpaid renewed package: bucketed by the new package start date (this week vs next week) as described above.
- Previous package: visit rows, payment rows, and payment history are untouched; the renewal is logged as its own activity as it is today.

## Technical notes

- `src/routes/_authenticated/clients.$id.tsx` — `RenewDialog` gains a query against `getClientAppointments` (now → +31 days), picks the earliest non-cancelled `start_at`, and seeds `package_start_date` from its clinic-local YMD.
- `src/routes/_authenticated/index.tsx` — `matchesFilter` receives the current/next work-week ranges (already returned as `week_start` / `week_end` by `getThisWeekScheduledClientIds` / `getNextWeekScheduledClientIds`) and applies the future-start-date override for `payment_due_this_week`, `payment_due_next_week`, and `overdue_prior_weeks`.
- No server function signature changes, no database changes.
- Typecheck runs after the edits.
