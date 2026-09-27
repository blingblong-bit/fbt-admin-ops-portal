# Back should also return to the same scroll spot

## Likely cause (confirmed in step 1 before changing anything)
The app saves your scroll position continuously while you scroll. When you tap a client, the page briefly empties while the client record loads. That shrinks the page, which pushes the scroll back to the top, and that "top" position overwrites the spot you were at. When you come back, the app restores to the top.

## Fix
1. **Reproduce** in a test browser signed in: open No Package Info, scroll down, open a client, press Back, and check the saved position and where the page lands.
2. **Capture the position right when you tap**, the moment you leave a screen, and stop saving after that so the brief empty page can't overwrite it.
3. **Wait for the list to finish loading** before scrolling back. On a phone, don't cancel the restore just because you touch the screen right after tapping Back. Only cancel if you actually scroll.
4. Re-run step 1 on the dashboard tile and on All Clients, using both the on-screen Back and the phone's back button.

No changes to data, money, visits or texting. Nothing is published.

## Technical details
- `useScrollMemory`: subscribe to `router.subscribe("onBeforeNavigate")` to write `scrollY` for the current key and set a `frozen` flag. The scroll listener ignores events while frozen.
- Restore: poll until `scrollHeight` is large enough (extend to about 6s). Cancel on real user scroll (a `scrollY` change not caused by us), not on `touchstart`.
