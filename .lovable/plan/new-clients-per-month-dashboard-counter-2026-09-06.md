# New-Clients-Per-Month Dashboard Counter

## Goal
Add an admin-only dashboard tile that shows how many new clients were added each month, starting from **August 2026**. Selecting a month lists those clients sorted by their `created_at` date.

## Data (verified)
Monthly new-client counts from `created_at`:
- June 2026: 1,700 (bulk import — excluded; counter starts at August)
- August 2026: 34
- September 2026: 7 (current)

No new tables or server functions are needed — the dashboard already pages through every client via `useClients()`, so the monthly counts are derived client-side from the loaded `clients` array's `created_at`.

## Scope
- Form factor: a **dashboard tile** (per chosen form factor). Clicking it reveals a month selector (Aug → current month) with each month's count, plus the list of clients added that month, sorted by `created_at`.
- Visibility: **Admin only** (`staffHidden: true`, matching the existing payment tiles).
- Definition: a client counts for the month of its `created_at`, from August 2026 onward. Archived clients are included (they were genuinely added that month); soft-deleted records are excluded (consistent with the rest of the dashboard's `deleted_at is null` reads).

## Changes (single file: `src/routes/_authenticated/index.tsx`)

1. **Monthly grouping helper** — build a sorted list of `{ month: "YYYY-MM", clients: Client[] }` from `clients`, including only entries with `created_at >= 2026-08-01`, each month's list sorted by `created_at` descending (newest first). Memoized on `clients`.

2. **Tile** — add `new_clients` to `allTiles`:
   - `staffHidden: true` (admin only).
   - `label: "New Clients"`, icon `UserPlus`.
   - `count` = current month's new-client total; `sublabel` = current month name (e.g. "Sep").
   - `tone: "slate"` (turns amber if the current month has additions, optional).
   - Added to `DEFAULT_VISIBLE_TILES` so it shows by default for admin.

3. **New-clients view state** — add `newClientsActive: boolean` and `newClientsMonth: string` state. The `Tile` `onClick` is special-cased: when the tile key is `new_clients`, it sets `newClientsActive = true` and defaults `newClientsMonth` to the current month, instead of changing `filter`.

4. **Month selector + list** — when `newClientsActive` is true, render (in place of the normal filtered section header/list):
   - A header "New Clients by Month" with a back/close control that sets `newClientsActive = false`.
   - A horizontal month picker: one chip per month from August to current, each showing month name + count; selecting sets `newClientsMonth`.
   - The selected month's client list, sorted by `created_at` descending, rendered with `SmartClientCard` and the `created_at` date shown. The header shows the month's total (e.g. "September 2026 · 7 clients").
   - Selecting a card still navigates to the client detail page (unchanged behavior).

5. **Role guard** — because staff default-filter and tile filtering already run, the `new_clients` tile is excluded for staff via `staffHidden`. Add the tile key to the staff redirect-off effect's guard set only if needed; since it's filtered out of `tiles` for staff, no extra logic is required.

## Non-goals
- No new route/page (form factor is a tile, not a dedicated page).
- No changes to other tabs, the All Active list, Schedule Check, or client detail.
- No database migration, RLS, or server-function changes.

## Verification
- `bunx tsgo --noEmit` passes.
- In preview (admin): tile visible, clicking shows Aug (34) and Sep (7) with client lists; selecting a card opens client detail; back returns to the dashboard.
- In staff view: tile not present.
