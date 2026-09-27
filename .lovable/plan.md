# Make Needs Package Info actually sync from Square

## What I found
I checked all 67 clients in the tile against their Square appointments. Nothing was changed.

**1. The automatic fill almost never runs.** It has filled only 2 clients so far (Charlie and Wyatt Ellis).
- It only starts when someone with the **staff** role opens the dashboard. Admin and owner logins skip it.
- The nightly check that should also run it isn't scheduled at all. Only the renewal text timer is scheduled.
- Because of this, about 15 clients with clean Square numbers were never filled. Examples: Brandon Scott 2/8, Drew Hardison 4/8, Tyler Goode 6/8, Cameron Lappin 2/3, and Chris Dornon, Soloman Childers and Sonja Simmons, who each start 1/8 soon.

**2. "Custom Package" clients are skipped.** Ally Sharpe, Ginger Ennis (5/8), Tonya Miller and Jonas Roper have a package name but 0 visits. The fill treats any package name as "already set up".

**3. A single numbered visit is ignored.** Jayden May (1 of 8), Christian Banks (1 of 4), Sarah Vella (1 of 8), Maddox Liles (1 of 8 on Oct 1) and Reese Cunningham ("Lincoln County athlete 6 of 8") each have only one numbered appointment, so they're treated as too uncertain to use.

**4. Some would fill with old, finished packages.** Martha Grantham (8/8 in July), Jake Collins (3/3 in June) and David Gluch (April) have no recent appointments. Filling them would bring back packages that are long over.

**No change needed** for about 37 clients with no visit numbers in Square, and a few with notes like "NC", "Jump Program" or cancelled-only. These stay for manual review.

## Fix
1. **Run the fill for any staff, admin or owner login** when the dashboard opens, and **schedule the nightly check** so it runs even when nobody logs in.
2. **Include "Custom Package" clients** that have 0 visits, and keep any name and price they already have.
3. **Accept one numbered visit** when it's a clear "1 of N". Also accept a single mid-package number when it's the most recent visit, and mark the start date as estimated.
4. **Only fill current packages.** There has to be a numbered visit in the last 60 days or an upcoming one. Older clients stay in the tile for you to handle.
5. **Run it once right away** after the change, and send you the list of who was filled.
6. Same safety rules as before:
   - price left blank and marked "Price Needed"
   - no texts and no money changes
   - every change logged in the client's history
   - nothing published

## Technical details
- `src/routes/_authenticated/index.tsx`: trigger `autofillPackagesFromSquare` for staff, admin and superadmin. RLS already allows staff writes, and `is_staff` covers admins.
- New migration: add a pg_cron job at 3:30 AM Chicago that calls `/api/public/visit-diff-sweep` with the same auth header as the existing job.
- `package-autofill.server.ts`: allow the fill when `package_name` is blank or is "Custom Package" and total visits is 0. Add the recency gate: latest noted booking within 60 days, or a future booking.
- `packageAutofillFromBookings`: when the resolver returns `hub_fallback` only because there's a single note, still accept a lone parseable `n of N` note (a 1/N opener, or a latest past note with `startEstimated`).
- Tests: single 1/8, single future 1/8, stale sequence (rejected), and a Custom Package client.
