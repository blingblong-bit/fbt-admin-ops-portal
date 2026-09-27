# Why Square fixes don't show up in Hub after refresh

## What's likely happening (to confirm first)
Hub holds on to Square appointment data in three layers, so a fix made in Square can stay hidden for a while:
- Pages keep what they last read for up to 10 minutes (Visit Note Review, Visit Automation Review, the Square-based dashboard tiles) and only re-read if you press their own Refresh button.
- The server keeps a shared copy of Square appointments for 60 seconds, so pressing Refresh right after a Square edit can return the old copy.
- Square itself can take a short while after an edit before its search shows the new note.

## Steps
1. Read-only check of Bret Smith and Bob Hayes: pull their current Square appointments and run them through the same review logic. This tells us whether Square now looks clean (Hub problem) or still shows the old note/numbering (Square not saved or not yet updated).
2. If Square is clean but Hub isn't:
   - Refresh buttons ask the server for a fresh Square read (skip the 60-second shared copy).
   - Shorten page hold times for Square-based screens to 1 minute and re-read when you come back to the app/tab.
   - After refreshing Visit Note Review, also refresh the client page, dashboard tiles and Visit Automation Review so they all agree.
   - Show "Square read at 10:52 PM" on the review pages so it's clear how fresh the data is.
3. If Square still shows the old notes: report exactly which appointment and note is still wrong for each client. No code change.

Nothing is written to client records, payments or texts. Texting stays off; nothing is published.

## Technical details
- `effective-visit-state.server.ts`: `loadSquareBookingIndex(token, past, future, { fresh })` bypasses/replaces `indexCache` entry.
- `visit-note-review.functions.ts` / `visit-automation-review.functions.ts`: accept `{ fresh: boolean }`; Visit Note Review switches to the shared index loader (also removes its 9 unthrottled parallel Square calls, a 429 risk).
- Query staleTime 10m -> 60s on Square-backed queries; `refetchOnWindowFocus` on; Refresh invalidates `visit-note-review`, `visit-automation-review`, dashboard Square tiles, client-detail visit queries.
