# Package Info Needed instead of a false "Paid"

Today, a package client with no package price set shows a $0 balance, so the app labels them **Paid**. That is a guess, not a fact — we simply don't know what they owe. There are currently 42 active package clients with no package set up, 11 of whom have already handed over money.

## New behavior

For package clients with no valid price on file (price of $0 or blank), regardless of whether visits or a package name are filled in:

- Never show **Paid**. Show **Package Info Needed** (amber, matching the existing "Needs Package Review" look).
- Never present $0 as a real balance — the balance line reads "Package info needed" instead of a dollar figure.
- The card's main button routes to the existing package setup / No Package Info workflow instead of "Record Payment" or "View Client".
- Money already collected stays exactly as recorded and is shown as "Paid so far: $X", with the record still flagged for setup review.
- Clients staff already dismissed with "No package needed" stay out of this state, exactly as they do today.

Pay-per-visit clients are untouched: a zero balance is legitimate for them and keeps showing as it does now.

## Status order for package clients

1. No valid price on file → Package Info Needed
2. Paid more than the package costs with no prepared next package → Payment Review
3. Valid setup, owed > 0 → Owes $X
4. Valid setup, owed = 0 → Paid

Missing visit count or package name stay as setup-review signals, but the price alone decides whether a financial conclusion is possible.

## Payment tiles and totals

Unknown-package clients are excluded from the paid/unpaid dollar totals (they contribute $0 today anyway, and would otherwise be silently counted as settled). They continue to appear in the existing "Needs Package Review" count so nobody is hidden, and the weekly Payment Due groupings are unaffected.

## Not changing

No client's money, package price, visit count, or review flag values are edited by this work. This is classification and display only.

## Technical detail

- `src/lib/clients.ts`: add `packagePriceUnknown(c)` (`payment_model === "package"`, not dismissed, `Number(package_price) <= 0`) plus `paymentStatus(c)` returning, in order, `package_info_needed | payment_review | owes | paid`. Payment Review = `amount_paid > package_price` with no prepared renewal (`pending_renewal_*` unset), mirroring the webhook's existing rule. Extend `SimpleStatus` with `"Package Info Needed"` and wire it into `simpleStatus`, `simpleStatusClasses`, `simpleStatusDot`, and `primaryAction` (new `setup_package` action). `amountOwed`/`totalOwed` keep returning numbers unchanged; callers ask the new helper before rendering "Paid".
- `src/components/StatusBadge.tsx` and `src/components/SmartClientCard.tsx`: render the new status, swap the balance cell for "Package info needed" + "Paid so far", and point the primary button at `/clients/$id`'s package setup.
- `src/routes/_authenticated/index.tsx`: exclude incomplete-setup clients from `payment_due*` totals and from the "Paid" reading in the client list; keep the existing `needs_package_review` counter as the visibility path.
- `src/routes/_authenticated/clients.index.tsx` and `clients.$id.tsx`: same balance-cell treatment.
- New `src/lib/payment-status.test.ts` covering: no package info + $0 paid → not Paid; no package info + positive payment → not Paid, setup required; price missing + 8 visits configured + $0 paid → Package Info Needed; price missing + visits/name configured + positive payment → Package Info Needed; $375 package / $375 paid → Paid; $375 package / $0 paid → Owes $375; $375 package / $690 paid with no prepared renewal → Payment Review; pay-per-visit with no charge → valid zero balance.
