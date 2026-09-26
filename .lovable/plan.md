# Fix: back navigation reloads the whole page

## Problem

Pressing Back — either the in-app "← Back" button or the phone/browser back button — after tapping any dashboard tile reloads the whole page instead of instantly returning to the previous screen.

## Root causes to verify, then fix

1. **Dashboard remount refetches everything.** Going back to the dashboard remounts it, and every tile query re-runs from scratch, so the page visibly reloads. Fix: give the dashboard's queries a sensible cache lifetime (`staleTime`) and keep showing the last good data while refreshing in the background, so returning is instant and numbers simply update if they changed. (Builds on the previous focus-refetch fix.)

2. **In-app Back button can leave the app or reload.** The client-page Back button checks `router.history.length > 1`, which is also true when you arrived from outside the app — pressing it can jump out of the app or trigger a fresh load. Fix: track whether the previous entry is inside the app; if not, fall back to a normal in-app link (e.g. All Clients or the dashboard).

3. **Lost scroll/state on return.** Returning to the dashboard or a list should restore where you were (scroll position, open tile view) instead of starting over. Fix: enable the router's scroll restoration and keep tile-view state in the URL or cache so it survives back navigation.

## Steps

1. Audit the dashboard and list-page query setup (`src/router.tsx`, `src/routes/_authenticated/index.tsx`) for cache settings that force a full refetch on every mount; set a short `staleTime` and background refetch instead.
2. Rework the Back button logic in `clients.$id.tsx` (and add consistent Back handling on review/list pages) so it uses in-app history when available and a safe in-app destination otherwise — never a full page load.
3. Enable TanStack Router scroll restoration so back returns you to the same spot.
4. Verify with the browser tool: open a tile, open a client, press Back (both in-app and browser) — the previous screen should appear instantly without a reload flash, with correct numbers.

## Technical details

- Files: `src/router.tsx` (query client defaults), `src/routes/_authenticated/index.tsx` (dashboard queries), `src/routes/_authenticated/clients.$id.tsx` (BackLink), `src/routes/__root.tsx` (ScrollRestoration), plus any list pages missing back handling.
- No changes to visit counting, payments, texting (stays OFF), or stored data. Nothing is published.
