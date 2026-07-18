## What I found

The Lovable Cloud backend is healthy — this is a **frontend/publish issue**, not the database. Two separate things are broken:

1. **Published site (`fbt-admin-ops-portal.lovable.app`)** is returning HTTP 500 on every request, including `/`, `/favicon.ico`, and the `/api/public/renewal/tick` cron. Every worker log line is the same opaque `h3 swallowed SSR error: {"unhandled":true,"message":"HTTPError"}` with the same `content_hash` — meaning the last published build is broken and every request is hitting the same crash.
2. **Static preview builds** (the `id-preview-<sha>--...` URLs Lovable generates per snapshot) are also 500ing for recent shas.

The **sandbox dev preview (`localhost:8080`)** returns HTTP 200 and renders the dashboard correctly, so the current code in the editor is fine — only the previously published bundle is broken.

Root cause of the SSR error isn't visible: the SSR error handler is logging only the h3-wrapped message and not surfacing the underlying `Error`, so we can't see the actual stack from server logs. This usually means an in-render or module-init throw somewhere in the published bundle (e.g. a route module that references a missing env var at import time, or serialization of a non-serializable loader value).

## Recommended fix (fastest path back to working)

1. **Republish.** Because the current sandbox build is healthy, clicking **Publish → Update** in the top-right will build the current code and replace the broken bundle. This almost always clears both the published 500s and the newer static-preview 500s.
2. If republishing still 500s, the underlying error needs to be surfaced. Options:
   - Instrument the SSR error wrapper (`src/server.ts` + `src/lib/error-capture.ts`) to log the raw captured error before returning the fallback so we can see the real stack in worker logs.
   - Bisect recent changes to the dashboard route (`src/routes/_authenticated/index.tsx`) and to `src/routes/api/public/renewal.tick.ts`, which are the most recent additions and are both hit on every SSR pass.

## What I'm not doing yet

- No code changes. I want your go-ahead before adding instrumentation or reverting anything.
- I'm not touching the database, RLS, or any published data.

## Next step

Try **Publish → Update** first. If the site comes back, we're done. If it still 500s after that, tell me and I'll add SSR error instrumentation so we can see the real underlying error and fix it at the source.
