# Read-only investigation: Katie Farrier, Nick Smith, Keri Evans

Nothing gets changed: no client records, payments, review flags or billing types. No texts, no publishing, no Square changes.

## For each client
1. Current Hub package fields: package name, size, price, start date, visits used, amount paid, previous package owed, prepared renewal fields, billing type. Plus their current Master Dues balance and section (Due Now / Upcoming / Needs Review).
2. Square appointments for the last 180 days and the next 90: date (Chicago time), status, visit note, numbering, and where each package starts and ends. Uncertain boundaries get flagged as uncertain. Nothing is assumed.
3. Every Square payment linked to or matching the client (ID, Chicago date and time, amount, status, review flag, which package it was applied to), plus Hub payment and edit activity notes, including manual entries such as Venmo.
4. Each payment matched to the package or visit it pays for, then a check of whether the balance the Hub shows is supported by that evidence.
5. Findings grouped as **Confirmed** (Square and Hub evidence agree) or **Needs staff confirmation**.
6. The smallest safe correction for each client, with exact before and after values and the Master Dues amount before and after. These are previews only and are not applied.

## Specific checks
- **Katie:** her Oct 16 renewal (is it real and backed by a live 1/N in Square, and what size and price), the $175 Venmo payment (recorded where, and which package it pays), and the Sep 20 payment (which package it paid). Also whether a missing package record explains the gap.
- **Nick:** trace the $50, $425 and $50 payments, in date order, against his $345 balance. Check whether linked Square payments are missing from the Hub, were applied twice, or were applied to the wrong package.
- **Keri:** what each of the two Oct 14 payments covers (same amount close together is only a possible duplicate, not a confirmed one), and whether the provisional $50 balance is justified.

## Output
Findings in chat for each client, plus `/mnt/documents/billing-exceptions-investigation_v1.csv`. After that I stop and wait for your approval before any correction.

## Technical details
- Hub side: `read_query` on clients, client_activities, square_payments, dues_messages.
- Square side: the existing admin-only read path (`loadSquareBookingIndex(…, {fresh:true})`, `effectiveStateFor`, `getMasterDues`), run through `stack_modern--invoke-server-function`. If a direct Square payment lookup is needed, use a temporary signed read-only endpoint and delete it in the same session.
- No migrations. No writes to any table.
