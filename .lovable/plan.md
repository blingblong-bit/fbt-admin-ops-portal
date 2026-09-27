# Visit Note Review: stale results, Bob Hayes, Charles Parish, and a "This is correct" button

## What Square shows now (read live, nothing changed)
**Bob Hayes**: 9/11 (no note), 9/15 1/8 (you edited it at 11:19 PM), 9/17 2/8, 9/22 3/8, 9/24 4/8, then 9/29 5/8 and 10/1 6/8 coming up.
- Your fix worked. The numbers now run 1 to 6 with nothing skipped.
- He is probably still listed because the **9/11 appointment has no visit number**. That triggers "missing note". If 9/11 was an assessment or the last visit of an old package, the numbers are right. A "This is correct" button would clear him.
- Part of it was also the delay: you refreshed within minutes of editing, and Hub can hold old Square data for up to about a minute (plus 10 minutes on the page unless you press Refresh).

**Charles Parish**: 9/1 1/8, 9/3 2/8, then 9/8 3/8 cancelled, 9/10 4/8 cancelled, 9/22 3/8 cancelled, 9/24 4/8. His 9/29 and 10/1 appointments have **no number yet**.
- The review reads cancelled 4/8 (9/10) then cancelled 3/8 (9/22) as numbers going backward. The cancelled bookings were just renumbered and rebooked, so this is a false flag.
- The 9/29 and 10/1 appointments with no number add a "missing note" flag. Adding 5/8 and 6/8 in Square would clear it.
- He also has a second Hub record with no Square link (a separate issue, not changed here).

## Changes
1. **Rebooked cancellations don't cause flags.** When a cancelled number is later rebooked, or replaced by a lower number, it no longer counts as "going backward" or "skipped". This uses the same rule the visit counts already use. Late cancels that were never rebooked still count, like now.
2. **"This is correct" button** on each review card, with an optional short reason. The client leaves the list and the card records who confirmed it and when. If any of that client's Square appointments or notes change later, the confirmation expires and they come back if still flagged. A "Show confirmed" toggle lets you see or undo them.
   - This only hides the card from the review list. It does not change visit counts, renewals, dues or texts.
3. **Fresher data on Refresh.** Refresh always reads Square fresh instead of using Hub's one-minute shared copy. Square-based pages hold data for 1 minute instead of 10 and re-check when you return to the app. The "Checked at" time stays visible.
4. Re-run the review and report whether Bob and Charles drop off, and how many flags cleared overall.

Nothing is written to Square, client visit counts, payments or texts. Texting stays off; nothing is published.

## Technical details
- `square-visit-audit.ts` `detectNoteIssues`: skip `backward`/`skipped` comparisons involving entries where `isSupersededCancellation(seq, e)` or a cancelled entry is followed by a live booking with number less than or equal to its number. Add tests for Charles's pattern.
- New table `visit_note_confirmations(client_id uuid pk -> clients, fingerprint text, reason text, confirmed_by uuid, confirmed_at timestamptz)`. GRANTs for authenticated and service_role; RLS set to admin/superadmin via `has_role` for all operations.
- Fingerprint = hash of the sorted `booking_id|status|note` for the client's bookings in the review window. `getVisitNoteReview` hides cards whose confirmation fingerprint matches and returns `confirmed[]` separately. New server fns `confirmVisitNotes({client_id, fingerprint, reason})` and `unconfirmVisitNotes({client_id})`, both admin-checked.
- `loadSquareBookingIndex(..., { fresh })`; Visit Note Review uses the shared throttled loader (instead of 9 parallel calls). Refresh passes `fresh: true`. staleTime 60s plus `refetchOnWindowFocus` on the visit-note/automation review queries.
- Also add a roadmap.md entry for the "This is correct" button.
