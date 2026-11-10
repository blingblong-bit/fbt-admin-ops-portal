# Isolated Appointments demo update

## Changes
- Swap directly between appointment cards: select Swap client, tap an eligible second card, or cancel; show conflicts without changing either booking.
- Cancellation offers Count as a visit or Cancel without consuming a visit; repeat actions cannot double-count.
- Slot + carries its trainer/time and initially asks only for a client. Use available active-package visits; otherwise offer a fresh package with editable visits/price and retain earlier package history.
- Use a compact Sunday–Saturday date strip across views and appointment editing, swipe/week arrows, and a picker for distant dates.
- Show schedule and openings on matching time/trainer grids. Demo capacity is two clients per trainer/time; full slots are not openings and overlapping bookings for one client are rejected.
- Keep one inverse Day/Zoom action plus Trainer and Openings. Only actual Hub admins can add disposable demo trainers.

## Safety and technical details
- Changes stay in the authenticated fake-data demo and pure simulation helpers/tests; no production writes, services, messages, payments, settings, or publication.
- Track package identity on demo appointments so new packages do not rewrite earlier visit numbers or payment labels.
- Reuse the existing role hook without granting roles. Keep live Schedule and worklists untouched.

## Verification
- Test capacity, duplicate prevention, swap conflicts/atomicity, both cancellation choices/retries, package rollover/history, visit numbering, and admin-only trainer addition.
- Run the test suite and check the preview; exercise signed-in booking, swap, cancellation, dates, and openings on mobile and desktop without saving real records.
