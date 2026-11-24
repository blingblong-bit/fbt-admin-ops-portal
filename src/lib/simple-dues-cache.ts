import type { QueryClient } from "@tanstack/react-query";
/** New system refreshes only its own data; never changes legacy financial invalidation. */
export function invalidateFor(qc:QueryClient) {
  return qc.invalidateQueries({queryKey:["simple-dues"]}); // invalidation-ok: isolated additive system
}