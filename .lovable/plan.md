# Restore sign-in and remove the login hydration error

## Confirmed findings

- The login form renders, but authentication fails for everyone in both preview and production because the hosted Lovable Cloud backend is currently paused.
- The login route also produces a confirmed React hydration mismatch: the server renders an empty client-only route while the browser immediately renders the sign-in form.
- No login request reached the authentication logs during the checked period, which is consistent with the paused backend.

## Plan

1. **Resume Lovable Cloud**
   - Bring the hosted database and authentication service back online.
   - Wait until its health check reports ready before testing sign-in.

2. **Fix the login route hydration boundary**
   - Make `/auth` render the same stable sign-in form on the server and on the browser’s first render instead of disabling SSR for the whole route.
   - Keep session lookup and redirect behavior in the existing post-hydration effect so browser session state cannot alter initial markup.
   - Leave the protected application route client-gated so private pages do not attempt authenticated loading during public SSR.

3. **Verify the complete flow**
   - Confirm `/auth` renders without hydration errors.
   - Submit a real sign-in attempt and verify authentication requests reach the backend.
   - Confirm successful users leave `/auth`, reach the protected app, and signed-out users still return to login.
   - Check both preview and the published site; production will require publishing the code change after preview verification.

## Scope

No client records, payment data, permissions, or business logic will be changed.
