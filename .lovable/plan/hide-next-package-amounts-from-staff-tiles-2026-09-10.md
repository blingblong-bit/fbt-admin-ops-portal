# Hide next-package amounts from staff tiles

## Scope
- Keep dashboard tile counts and renewal labels available to staff.
- Hide every next-package dollar total from staff accounts.
- Preserve the current dollar displays for admin and superadmin accounts.
- Do not change package, payment, renewal, or database behavior.

## Implementation
1. Centralize the dashboard tile amount visibility rule so staff tile definitions cannot render either a primary money value or an additional “next package” value.
2. Keep the existing Needs Renewal client count visible while suppressing its aggregate next-package amount for staff.
3. Preserve the existing admin-only Payment Due tiles and their next-package totals.
4. Add focused tests for staff versus admin tile rendering, including the Needs Renewal amount and the additional next-package amount fields.

## Validation
- Verify as a staff account that no tile displays a next-package dollar amount.
- Verify as an admin account that the same amounts remain visible.
- Run the focused tests and TypeScript validation.
