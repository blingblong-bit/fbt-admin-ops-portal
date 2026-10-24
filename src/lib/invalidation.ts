// Single place that decides what to reload after a successful save.
// Call ONLY from a mutation's onSuccess (never onError/onSettled), so a failed
// save never triggers a refresh. Screens must not hand-roll invalidateQueries
// for financial/visit keys — see invalidation.test.ts coverage check.
import type { QueryClient, Query } from "@tanstack/react-query";

export type InvalidationEvent =
  | "renewal-changed"
  | "package-edited"
  | "payment-changed"
  | "visit-changed"
  | "client-archived"
  | "client-info-changed"
  | "square-link-changed"
  | "schedule-hide-changed"
  | "square-sync";

/** Keys whose 2nd element is a client id; narrowed to that client when given. */
const PER_CLIENT = new Set([
  "client",
  "activities",
  "payment-allocations",
  "package-overrides",
  "visit-tracking",
  "unchecked-appointments",
  "client-appointments",
  "dues-messages",
]);

const MONEY = ["master-dues", "renewal-forecast", "clients", "dues-texts-counts", "dues-texts-board", "dues-queue"];
const PROFILE = ["client", "activities", "payment-allocations", "package-overrides"];
const SCHEDULE = [
  "schedule-check",
  "missed-check-ins",
  "day-review",
  "completed-visit-bookings",
  "scheduled-client-ids",
  "scheduled-this-week-client-ids",
  "scheduled-next-week-client-ids",
  "scheduled-prior-weeks-last-dates",
  "visit-tracking",
  "unchecked-appointments",
  "client-appointments",
  "visit-note-review",
  "visit-automation-review",
];
const PAYMENTS = [
  "square_payments_needs_review",
  "square_payments_needs_review_count",
  "square_payments_pending",
  "square_sync_log",
  "payment-history-week",
];

export const EVENT_KEYS: Record<InvalidationEvent, readonly string[]> = {
  "renewal-changed": [...MONEY, ...PROFILE],
  "package-edited": [...MONEY, ...PROFILE, "package_review_dismissals"],
  "payment-changed": [...MONEY, ...PROFILE, ...PAYMENTS],
  "visit-changed": [...MONEY, ...PROFILE, ...SCHEDULE],
  "client-archived": [...MONEY, ...PROFILE, ...SCHEDULE, "linkable-clients"],
  "client-info-changed": [...MONEY, ...PROFILE, "package_review_dismissals", "dues-messages"],
  "schedule-hide-changed": [...MONEY, ...PROFILE, ...SCHEDULE],
  "square-link-changed": [...MONEY, ...PROFILE, ...SCHEDULE, "linkable-clients", "square-reviews"],
  "square-sync": [
    ...MONEY,
    ...PROFILE,
    ...SCHEDULE,
    ...PAYMENTS,
    "linkable-clients",
    "square-reviews",
    "package_review_dismissals",
  ],
};

export function matchesEvent(event: InvalidationEvent, key: readonly unknown[], clientId?: string): boolean {
  const head = key[0];
  if (typeof head !== "string" || !EVENT_KEYS[event].includes(head)) return false;
  if (clientId && PER_CLIENT.has(head) && key.length > 1) return key[1] === clientId;
  return true;
}

/**
 * Reload everything affected by `event`. cancelRefetch: an older in-flight
 * fetch is cancelled and its result discarded, so it can't overwrite newer data.
 */
export function invalidateFor(
  qc: QueryClient,
  event: InvalidationEvent | InvalidationEvent[],
  opts: { clientId?: string } = {},
): Promise<void> {
  const events = Array.isArray(event) ? event : [event];
  return qc.invalidateQueries(
    { predicate: (q: Query) => events.some((e) => matchesEvent(e, q.queryKey, opts.clientId)) },
    { cancelRefetch: true },
  );
}
