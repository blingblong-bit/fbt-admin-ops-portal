# Misallocated-payment review (read-only results + next step)

Two read-only checks were run: (1) active package clients whose current package shows more paid than its price, and (2) closed packages that recorded more paid than their price. No records were changed.

## Strong suspects (same pattern as Spencer)

| Client | Evidence | Extra on old package | Confidence |
|---|---|---|---|
| Sara Elliot | 8-session $375 package from 8/25 shows $750 paid at 7/8 visits; no next package set up | $375 | High suspect |
| Preston Blake | 8-session $375 from 8/14 shows $750 paid at 7/8, and the 10/20 prepared renewal also holds $375 | $375 (possible double-count) | High suspect |
| West Lambert | Package closed 9/23 recorded $750 paid on a $375 package | $375 | Medium (may already be carried; check current package) |
| Analeigh Spain | $375 package from 8/5 shows $562.50 paid at 1/8 | $187.50 | Medium |
| Rupa Blackwell | $187.50 4-visit package from 9/17 shows $375 at 2/4 | $187.50 | Medium |
| Caseon Casteel | $100 2-visit package from 9/30 shows $250 at 0/2, renewal prepared 10/30 with $0 paid | $150 | Medium |
| Haven Thomas | $375 package from 6/5 shows $720 paid | $345 | Medium |

## Likely setup gaps, not misallocation (lower priority)

Package price $0 or no start date, so any payment looks like an overpayment: Priya Patel ($375), Julie Heltsley ($200), Colin Bills ($100), Sarah Vella ($50), Justin Mines ($50), Lavon King ($300 of $300, no start date), Everett Farrier, Jonathan Owens, Olivia Epley (1/1 single visit $50 extra). Jake McGee had a closed $50 package that recorded $100 paid; it was already flagged for staff review earlier.

## Next step (needs approval, read-only)

For each strong and medium suspect, in Square: find the payment that pushed the package over its price, then check whether the next appointment is numbered "1 of N". If so, it's the same problem as Spencer's: the payment belongs to a new package the Hub never started. Report each client as Verified, Not an issue, or Unclear. That takes about 2 to 3 lookups per client, and no changes are made.

Each verified case is fixed separately, only with your approval, the same way Spencer's was.

## Technical notes

- Check 1: active, non-archived package clients where the money recorded as paid on the current package is more than its price.
- Check 2: history entries for closed packages where the money recorded as paid was more than the price.
- Verification uses Square's payment and appointment notes, compared with the payment's recorded split.
