# Dues Texts tile + one-page review & send

One place where an admin can see every dues text that needs attention, check the wording and amount, and press Send Now. No change to consent rules, texting service, replies, opt-outs, draft creation, Pre-Renew, payments or packages.

## Dashboard tile

- New tile "Dues Texts", visible to admin/superadmin only (hidden from staff like the other money tiles).
- Compact counts, with Ready to Send as the big number, plus small lines for Blocked and Payment Received.
- For admins only, a small line with the total dollars represented by the ready-to-send balance/renewal texts. Staff never see it (they can't see the tile at all).
- Clicking it opens the new Dues Texts page.
- Counts reflect only what is actionable today (ready / blocked / closed-by-payment), never the whole message history.

## Dues Texts page (`/dues-texts`, admin only)

Four stacked sections, mobile-friendly cards, newest-relevant first.

**1. Ready to Send** — drafts that pass every check right now. Each card shows client name (links to the client), message type (Opt-in Confirmation / Balance Due / Renewal Due), why it exists, exact amount when relevant, visit progress (e.g. 3/8), package name, renewal start date when relevant, texting status pill, the exact message text, and a Send Now button.

**Confirmation first.** If a client's one-time opt-in confirmation hasn't gone out yet, their balance/renewal card is shown as "Confirmation required first" with the confirmation text and a Send Confirmation button instead of Send Now. After the confirmation sends, the dues card becomes sendable. Never two sends in one click.

**2. Blocked** — drafts that exist but cannot go out, each with the plain reason (consent not recorded, opted out, invalid or missing phone, Package Info Needed, Payment Review, balance no longer due, prepared renewal data incomplete). No Send button. Where the fix lives elsewhere, a direct action: Record Consent, Open Client, Fix Package Info, Review Payment.

**3. Sent / Delivered** — recent successful sends: client, type, time sent, delivery status, amount referenced. Quick confirmation only; full history stays on the client's Messages tab.

**4. Payment Received / Closed** — drafts that became unnecessary because the client paid first, marked "Payment Received — No Message Needed". No action.

A "Refresh drafts" button reuses the existing generator, and the banner still appears when sending is switched off.

## Sending

Send Now calls the existing send function unchanged, so every existing safety check still runs at send time: client re-read fresh, consent still valid, no later opt-out, valid phone, obligation still real, amount still due, request key never sent before. If the amount moved, the text is rebuilt and the admin has to confirm the new wording. If it was paid, the draft closes as Payment Received and nothing sends.

## Permissions

Tile and page are admin/superadmin only, guarded both in the page and on the server. Staff keep read-only message history on client records and get no send controls.

## Technical notes

- New server function `getDuesTextsBoard` in `src/lib/dues-messaging.functions.ts`: admin-asserted; loads `dues_messages` plus the referenced clients, and returns `{ ready, blocked, sent, closed, counts, readyTotal }`. Ready/blocked classification is recomputed from the live client via the existing `buildBalanceDraft` / `buildRenewalDraft` / `buildConsentConfirmationDraft` + `isSendable`, not trusted from the stored row. Each row carries client display context (name, package name, visits used/total, renewal start date, eligibility) so the page needs no second query.
- "Recent" in Sent / Delivered means the last 7 days (by sent time, falling back to created time); older sends live only on the client's Messages tab.
- `readyTotal` sums balance_due and renewal_due amounts only — opt-in confirmations carry no money and contribute $0.
- A pure helper (new `src/lib/dues-texts-board.ts`) does the grouping, confirmation-gating, the 7-day window and the counting so it is unit-testable without the database; tests added to the existing Vitest suite, including: a confirmation draft appears in Ready but adds $0 to `readyTotal`, and a sent message older than 7 days is excluded from Sent / Delivered.
- New route `src/routes/_authenticated/dues-texts.tsx` with `beforeLoad: requireAdmin`, its own `head()` metadata, reusing `AppShell`, `SmsEligibilityPill`, `SendingDisabledBanner`, and `sendDuesMessageNow` via `useServerFn`.
- Dashboard: one new entry in `allTiles` in `src/routes/_authenticated/index.tsx` with `staffHidden: true` and `href: "/dues-texts"`, money passed through the existing `visibleTileMoney` path; a nav link added in `src/components/AppShell.tsx` under the admin group.
- Existing "Send Dues Message" and "Messaging Preview" pages stay as they are; the new page links to them.
- No schema change, no write path changes. Vitest and TypeScript run before publishing.
