# Dashboard tiles going wrong after a refresh

## What happens
When you come back to the app (switch back to it on your phone, or it wakes up), everything reloads at once. Afterwards some tiles show wrong or empty counts until you fully close and reopen the app.

## Most likely cause (not yet confirmed — step 1 confirms it)
1. When the app wakes up, the sign-in system re-announces "signed in". The app treats that as a brand-new login and throws away and reloads every tile's data at the same moment.
2. That reload can start a split second before the sign-in has finished renewing itself. During that gap:
   - the client list can come back **empty instead of failing** (the database simply shows nothing to an unrecognised visitor), so tiles quietly drop to 0 or lose people;
   - the schedule/renewal/dues lookups get refused, and the tiles that rely on them show partial numbers.
3. Nothing retries after the sign-in finishes, so the bad numbers stay until the app is restarted. No saved data is affected — it's only what's on screen.

The preview logs from this session are empty, so this is inferred from how the code behaves, not yet caught in the act.

## Plan
1. **Reproduce first**: open the dashboard in a test browser, simulate the app going to the background and returning (and an expiring sign-in), and record which tile requests come back empty or refused. If the cause turns out different, I'll report back before changing anything.
2. **Only reload everything on a real sign-in change** (a different person signs in or out), not when the same person's sign-in is merely renewed.
3. **Never accept an empty client list while signed-out/renewing**: treat it as a failure so it retries, and keep showing the last good numbers meanwhile.
4. **Retry refused lookups automatically** once the sign-in is renewed, so tiles fix themselves without a restart.
5. Re-run the step 1 test to confirm tiles stay correct after returning to the app.

No changes to money rules, visit counting, texting (stays OFF), or stored data. Nothing is published.

## Technical details
- `__root.tsx` `onAuthStateChange`: supabase-js emits `SIGNED_IN` on visibility-regain/session recovery; currently triggers `router.invalidate()` + `queryClient.invalidateQueries()` globally. Change to compare previous vs new `user.id`; ignore same-user `SIGNED_IN`/`TOKEN_REFRESHED`.
- `useClients` in `_authenticated/index.tsx`: before querying, `await supabase.auth.getSession()`; if no session, throw so React Query retries and retains prior data. Same guard for the count queries.
- Server-fn queries (`renewal-forecast`, `scheduled-*`, `missed-check-ins`, `dues-texts-counts`, visit review): add `retry` with backoff on 401, and on `TOKEN_REFRESHED` invalidate only queries currently in error state.
- Verify via Playwright: dispatch `visibilitychange`, force a short-lived session, capture network + tile counts before/after.
