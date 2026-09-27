# Auto-fill package info from Square visit notes

## Goal
When a client with no package info shows up in Square with a numbered visit note (e.g. `1/8` on Monday), the Hub automatically sets up their package from that note instead of leaving them blank like Gabbi Gardner was. The price can't come from Square, so the client is flagged for staff to enter the price.

## Behavior
- For any active client with **no package info** (no package name / total visits), check their Square appointments for numbered visit notes.
- If a coherent numbered sequence exists (e.g. `1/8`, `2/8`):
  - Set **total visits** from the note's denominator (8).
  - Set **visits used** to the latest past numbered visit.
  - Set **package start date** to the date of the `1/N` visit (or earliest numbered visit if no `1/N`).
  - Set a package name like "8-Visit Package" (matching existing naming).
  - Leave **price at $0 / blank** and mark the client **Package Info Needed** so they appear for staff to enter the price.
  - Log a client-history note: "Package auto-created from Square visit notes — price needed."
- If the Square notes are incoherent or unreadable, do **not** guess — leave the client blank and flag them for review instead.
- Pay-per-visit clients and clients staff dismissed with "No package needed" are never auto-filled.
- No texts, dues drafts, or payment changes are triggered by the auto-fill; it only populates the package fields. Texting stays OFF.

## Where it runs
- A new step in the existing nightly/report sweep (same place the effective-visit resolver already reads Square), so it's checked daily without staff action.
- Also runs when staff open the "First Visit — No Package Info" review list, so a Monday appointment is picked up the same day.

## UI
- The existing "First Visit — No Package Info" tile/list shows auto-filled clients with a "Price needed" badge so staff know what remains.
- Client page shows the package as usual, with the history note explaining it came from Square.

## Safety
- Reuses the existing effective-visit resolver and superseded-cancellation logic (Jenny/Katie fixes) so cancelled-then-rebooked visits don't corrupt the count.
- One-time backfill run for the ~26 clients currently blank-but-numbered in Square (from the earlier audit), each logged with a history note.
- Tests: coherent sequence auto-fills; incoherent sequence flags only; pay-per-visit and dismissed clients untouched; no duplicate auto-fill on re-run.

## Technical notes
- Logic lives in `src/lib/effective-visit-state.ts` (detection) plus a new guarded write path in `src/lib/schedule.functions.ts` or a new `package-autofill.functions.ts`.
- Writes go through the existing clients table validation trigger; `visits_used` never exceeds `package_total_visits`.
- No schema changes expected; uses existing `needs_review` / status fields and `client_activities` for history.
- Nothing is published; texting remains OFF.
