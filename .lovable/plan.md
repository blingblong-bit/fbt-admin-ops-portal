# First Visit — No Package Info, Needs Review

A new group for brand-new clients whose first visit was just an assessment, so no real package was ever set up. They stay flagged until someone either sets a real package or marks them as not needing one.

## Who lands in the group

An active (non-archived, non-deleted) client with **no package info**: `package_total_visits = 0` and no package name.

The label everywhere is: **First Visit — No Package Info, Needs Review**.

Not included: archived/deleted clients, pay-per-visit clients (that's a deliberate model, not a gap), and anyone already dismissed.

## How they leave the group

- **Automatically** — the moment a real package is saved on the client (visits greater than zero), they drop out of the tile and the badge disappears.
- **Manually** — a "No package needed" button on the client detail page dismisses them. This writes a dismissal to their timeline so it's auditable, and an "Undo" is available on the client page if it was a mistake.

## Where it shows

1. **Dashboard tile** — "First Visit — No Package Info" with a count. Clicking it filters the client list underneath to exactly that group, like every other tile. No dollar amounts on the tile, so it's safe for staff.
2. **Badge** — a small amber "Needs Package Review" badge on:
   - the client detail page header (next to the existing Renewal Pending badge), and
   - the client's row/card on Schedule Check.

The badge is the cue at the desk: when that client walks in for their second visit, staff can see immediately that a package still needs to be set.

## Technical notes

- Cohort helper `needsPackageReview(client, dismissed)` added to `src/lib/clients.ts`: active status, `package_total_visits === 0`, blank `package_name`, `payment_model !== 'pay_per_visit'`, not dismissed.
- Dismissal reuses the existing `client_activities` pattern (no schema change): activity type `package_review_dismissed`, undone by a later `package_review_redo` row; a small hook (mirroring `useRenewalFlaggedClientIds`) loads the current dismissed set for the dashboard and Schedule Check in one query.
- `src/routes/_authenticated/index.tsx`: new `FilterKey` `needs_package_review`, label, `matchesFilter` case, counter, and tile entry; added to `DEFAULT_VISIBLE_TILES` so it shows without customizing.
- New `src/components/PackageReviewBadge.tsx`, rendered in `clients.$id.tsx` header and in the Schedule Check client rows.
- Dismiss / undo buttons on `clients.$id.tsx` only (not on the schedule list, to keep that list tap-safe).
- Also folding in a small fix to the sign-in page so it stops throwing a hydration warning on load.
- Typecheck runs after the edits.
