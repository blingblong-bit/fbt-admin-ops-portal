# Fix "Loading Failed" on the login screen

## What I checked

- The published login page at `/auth` returns HTTP 200 and renders the full sign-in form when loaded fresh from a clean browser — form, logo, and button all present, no failed network requests.
- Visiting `/` while signed out correctly redirects to `/auth?redirect=/`.
- Server logs for the last hour show no errors — only successful page requests and Square webhooks.
- The phrase "Loading Failed" does not exist anywhere in the app's code. It is the browser's own message (Safari says "Load failed") when a JavaScript file the page asks for cannot be fetched.
- One real defect did show up on the published site: a React hydration mismatch error (#418) fires on first load of the login screen, because the login and protected-area routes are rendered client-only while the server still emits shell HTML for them.

## Diagnosis

Since a clean browser loads the page fine, the failure is specific to the affected device's cached copy of the app. The most likely cause: after a redeploy, the browser holds an old cached page that references JavaScript files with old filenames that no longer exist on the server. The fetch fails, and the browser surfaces "Loading Failed" with nothing rendered. The hydration mismatch makes this worse, because the app has no recovery path when its startup script fails — it just stops.

This is not something I can reproduce headlessly, so the plan is to make the app self-heal from it rather than guess at a one-off cause.

## What to build

1. **Auto-recovery from failed script loads.** Add a small startup guard that listens for module/chunk load failures. On the first such failure, it clears caches and does a hard reload once (guarded by a session flag so it can never loop). This turns a permanent "Loading Failed" into an automatic recovery.

2. **A visible fallback instead of a blank screen.** Add a minimal inline block in the page shell that shows "Couldn't load the app" plus a "Reload" button if the app has not started within a few seconds. This is plain HTML/CSS in the shell, so it works even when the JavaScript bundle fails entirely.

3. **Fix the hydration mismatch on the login screen.** Make the client-only routes render nothing (or a matching placeholder) on the server so server and browser markup agree, eliminating React error #418 on the published site.

4. **Cache-safety on the shell document.** Confirm the published HTML document is served with no-cache headers so a stale page never outlives its scripts; add the headers if they are missing.

## Immediate workaround for you

On the device showing "Loading Failed": fully close the tab, then reload with cache bypass (iPhone/Safari: Settings > Safari > Clear History and Website Data, or use a Private tab; desktop: Ctrl/Cmd+Shift+R). If it loads after that, it confirms the stale-cache diagnosis, and the changes above stop it recurring.

## Technical notes

- Startup guard added as a tiny inline script in the root shell (`src/routes/__root.tsx`) plus a `vite:preloadError` / `error` listener in the client entry; recovery flag stored in `sessionStorage`.
- Hydration fix: give `ssr: false` routes (`/auth`, `/_authenticated`) a matching `pendingComponent` / server placeholder so markup lines up.
- No changes to auth logic, Supabase clients, or any business logic.
