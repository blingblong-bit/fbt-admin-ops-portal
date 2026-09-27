# Back returns you to exactly where you were

## Why it happens now
The open tile (e.g. No Package Info), the search box, the status filter, the "show all tiles" toggle and the New Clients month live only in temporary screen memory. Opening a client and pressing Back rebuilds the dashboard from scratch, so it resets to the default tile at the top.

## Fix
1. **Remember the dashboard view in the page address.** Tile, search, status filter, show-all-tiles and New Clients month are saved in the address. Back restores the same tile with the same list, and a page refresh or shared link opens the same view too.
2. **Return to the same scroll spot.** After the list reloads, the page scrolls back to where you were (and the client you tapped stays in view). Scroll position is stored per screen so it waits for the list to finish loading before scrolling.
3. **Same treatment site-wide** for list screens with filters/search: All Clients, Deleted Clients, Schedule Check, Dues Texts, Send Dues Message, Visit Note Review, Visit Automation, Merge Center, Missed Check-ins, Renewal Review, Notes Ledger, Sync Log, Payment History.
4. **Consistent Back buttons.** One shared Back button used on the client page and other detail/review pages: it goes to the previous screen in the app; if you arrived directly (no in-app history), it goes to a sensible page instead of leaving the app.
5. **Check it**: open No Package Info, scroll down, open a client, press Back (on-screen and phone back) — same tile, same spot. Repeat on All Clients and Schedule Check.

No changes to money, visits, texting (stays OFF) or stored data. Nothing is published.

## Technical details
- `index.tsx`: add `validateSearch` (zod, all optional with defaults: `tile`, `q`, `status`, `all`, `month`); replace `useState` for filter/search/statusFilter/showAllTiles/newClientsActive/newClientsMonth with `Route.useSearch()` + `navigate({ search: prev => ..., replace: true, resetScroll: false })`. Search typing debounced before writing to URL. Staff role guard still forces away from payment-due keys.
- Scroll: router already has `scrollRestoration: true`, but restoration fires before async lists render. Add a small `useRestoreScroll(key, ready)` hook that saves `window.scrollY` in sessionStorage on navigate-away and restores once data is loaded; also `getScrollRestorationKey` = pathname+search.
- Extract `BackLink` from `clients.$id.tsx` into `src/components/BackButton.tsx` (`useCanGoBack` + `router.history.back()`, with `fallbackTo` prop) and reuse on detail/review pages.
- Apply the same URL-search conversion to the other listed routes where they hold filter/search/tab state in `useState`.
