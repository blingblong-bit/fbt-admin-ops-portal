# Needs Renewal check-up: one stale-refresh gap

Overall the Needs Renewal work is behaving correctly. The math, the money split, the
prepared-renewal states and the check-in behaviour all line up. One small refresh
problem is worth fixing.

## What is working

- The list decides who needs renewing from the real appointment schedule: visits left
  vs. upcoming booked appointments, cancelled/past appointments ignored, looking 90 days ahead.
- A prepared next package uses the staff-chosen start date for which week it counts in.
- If every upcoming booking gets cancelled, the prepared package still shows in a
  "no upcoming appointment" state with Edit and Cancel, and correctly stays out of the
  weekly money totals.
- Money is counted once: old package debt always sits in Overdue, current package debt
  in This Week / Next Week, and the combined figure is used wherever a single "owes" number shows.
- Check In works for someone at the end of their package when a next package is prepared,
  and is still blocked when nothing is prepared. The "Next Package Ready" tag shows, and the
  scary "package complete" warning is hidden on the visit that starts the new package.
- Live data confirms it: 238 active clients, 42 have used up their package, nobody currently
  carries old-package debt, and today's renewal for Zoe Zill recorded correctly
  (new package $400, 8 visits, count restarted at 1).

## The one problem

When staff check someone in and that check-in activates their prepared package, the
dashboard's Needs Renewal tile is not told to reload. The client can keep appearing in
Needs Renewal for up to a minute afterwards, or until the page is reloaded. Nothing is
saved wrong — it's only the screen lagging behind.

## Fix

Tell the dashboard to reload the Needs Renewal list after a check-in, from both places a
check-in can happen: the Schedule Check page and the client's own page.

Technical: add `queryClient.invalidateQueries({ queryKey: ["renewal-forecast"] })` to
`completeMut` in `src/routes/_authenticated/schedule-check.tsx` (~line 97) and to the
`refresh()` in `completeVisit` in `src/routes/_authenticated/clients.$id.tsx` (~line 124).
No logic, schema, or money changes.

## After the change

Typecheck, then confirm on the running app that a check-in which starts a prepared package
drops the client out of Needs Renewal immediately.
