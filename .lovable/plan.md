
## Side-by-side: Zach Wolberg's two records

| Field | Record A (hyphenated — "Due this week") | Record B (no-hyphen — "Not scheduled") |
|---|---|---|
| id | `de974856-e7c7-4c06-b36d-b51f5c4db86e` | `0d27d25b-1eb3-4e97-8b09-d6a8766ff9a6` |
| phone | `931-581-4435` | `+19315814435` |
| email | — | zachwolberg11@gmail.com |
| square_customer_id | **`BC6Y9B5X3T5TJG7E80VVX8VY8C`** | **null** |
| status | active | active |
| deleted_at | null (unarchived) | null (unarchived) |
| manual_active | true | true |
| package | 8-Visit Package, $375, start 2026-05-18 | same |
| visits_used | null | 1 |
| amount_paid | $0.00 | $0.00 |
| amount_owed | $375 | $375 |
| internal_notes | — | "Imported from Square Production" |
| square_payments rows | 0 | 0 |

Neither record is currently archived (`deleted_at` is null on both). "Due this week" vs "Not scheduled" is derived entirely from `square_customer_id`: only Record A has one, so only A pulls live Square bookings.

### Answer to your question

**Yes.** The hyphenated record (A) holds the only real Square link (`BC6Y9B5X3T5TJG7E80VVX8VY8C`). The no-hyphen record (B) has no `square_customer_id` at all, so it can never show bookings or receive Square payments until that ID moves. A pure status swap would leave the "newly-active" B record disconnected from Square.

Record B does hold two things A lacks: the email `zachwolberg11@gmail.com` and `visits_used = 1`. Those should be preserved on B.

Relevant history: on 2026-07-01 B was originally the Square-linked record; a bulk merge archived A into B. On 2026-07-13 B was deleted; on 2026-07-17 the Square link was swapped from B to A ("swapped from soft-deleted duplicate"). On 2026-07-20 B was restored. That's how the Square ID ended up on the "wrong" record.

## Proposed plan (nothing runs until you approve)

1. **Transfer Square link A → B** (single migration/data update):
   - Set `clients.square_customer_id = 'BC6Y9B5X3T5TJG7E80VVX8VY8C'` on record B.
   - Clear `clients.square_customer_id` on record A (unique constraint — must clear A first, then set B, in one transaction).
2. **Flip active/archived**:
   - Record A: set `deleted_at = now()`, `manual_active = false`, `status = 'archived'`.
   - Record B: leave `deleted_at = null`, `manual_active = true`, `status = 'active'` (already is).
3. **Log activities** on both records:
   - On B: `square_link` — "Square customer BC6Y…8VY8C swapped back from de974856 (status flip)".
   - On A: `archived` — "Archived; Square link + active status transferred to 0d27d25b".
4. **No changes** to `package_price`, `amount_paid`, `visits_used`, `package_start_date`, email, or phone on either record. B keeps `visits_used = 1` and its email; A keeps its hyphenated phone as an archived historical record.

### Verification after

Re-query both rows and confirm: B has the Square ID and is unarchived; A is archived with no Square ID; Schedule Check "Due this week" now shows B (no-hyphen) with live bookings.

Approve and I'll run it as one migration + one activity insert.
