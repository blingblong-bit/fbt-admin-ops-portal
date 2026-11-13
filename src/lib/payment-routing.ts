/**
 * Reference implementation of the money rules enforced in the database by
 * `apply_square_payment` and `renew_client_package`.
 *
 * The database functions are the source of truth (they run under a row lock);
 * these mirrors exist so the rules are readable and testable in one place.
 * Keep them in sync with the SQL.
 */

export type PaymentRoutingState = {
  previousPackageOwed: number;
  amountPaid: number;
  packagePrice: number;
  pendingRenewalPaid: number;
  /** A prepared renewal exists when it has a start date. */
  hasPreparedRenewal: boolean;
  /** Price of the prepared renewal; paid-ahead money is capped at it. Unknown = holds nothing. */
  pendingRenewalPrice?: number | null;
};

export type PaymentRouting = {
  toPreviousPackage: number;
  toCurrentPackage: number;
  toPendingPackage: number;
  /** Money that fits no open package. Kept on the current package as a recorded overpayment for Payment Review — never credit. */
  unallocated: number;
  next: Pick<PaymentRoutingState, "previousPackageOwed" | "amountPaid" | "pendingRenewalPaid">;
};

/**
 * Debt first, then the open balance on the current package, and only then the
 * prepaid bucket of an already-prepared, priced renewal (up to its price). Any
 * excess stays on the current package as a reviewable overpayment — a general
 * account credit is never created, carried, or applied.
 */
export function routePayment(state: PaymentRoutingState, amount: number): PaymentRouting {
  const prevOwed = Math.max(0, Number(state.previousPackageOwed ?? 0));
  const paid = Math.max(0, Number(state.amountPaid ?? 0));
  const price = Math.max(0, Number(state.packagePrice ?? 0));
  const pendingPaid = Math.max(0, Number(state.pendingRenewalPaid ?? 0));
  const amt = Math.max(0, Number(amount ?? 0));

  const toPreviousPackage = Math.min(prevOwed, amt);
  let remaining = amt - toPreviousPackage;

  let toCurrentPackage = Math.min(Math.max(0, price - paid), remaining);
  remaining -= toCurrentPackage;

  let toPendingPackage = 0;
  let unallocated = 0;
  if (remaining > 0 && state.hasPreparedRenewal) {
    const cap = Math.max(0, Number(state.pendingRenewalPrice ?? 0) - pendingPaid);
    toPendingPackage = Math.min(cap, remaining);
    remaining -= toPendingPackage;
  }
  if (remaining > 0) {
    // No general credit: the money stays recorded (never lost) on the current
    // package and the client is flagged for Payment Review.
    unallocated = remaining;
    toCurrentPackage += remaining;
    remaining = 0;
  }

  return {
    toPreviousPackage,
    toCurrentPackage,
    toPendingPackage,
    unallocated,
    next: {
      previousPackageOwed: prevOwed - toPreviousPackage,
      amountPaid: paid + toCurrentPackage,
      pendingRenewalPaid: pendingPaid + toPendingPackage,
    },
  };
}

export type RenewalTransition = {
  unpaidCarriedForward: number;
  previousPackageOwed: number;
  /** Paid amount the new package starts with. */
  amountPaid: number;
  prepaidApplied: number;
  /** Set when the renewal must be refused because legacy excess would otherwise be silently dropped or reused. */
  blocked: string | null;
};

/** What a renewal does to the money, mirroring `renew_client_package`. */
export function computeRenewalTransition(
  state: Pick<PaymentRoutingState, "previousPackageOwed" | "amountPaid" | "packagePrice" | "pendingRenewalPaid">,
  paidNow = 0,
  newPrice?: number | null,
): RenewalTransition {
  const unpaid = Math.max(0, Number(state.packagePrice ?? 0) - Number(state.amountPaid ?? 0));
  const prepaid = Math.max(0, Number(state.pendingRenewalPaid ?? 0));
  const curOver = Number(state.packagePrice ?? 0) > 0 && Number(state.amountPaid ?? 0) > Number(state.packagePrice ?? 0);
  const blocked = curOver
    ? "current package has money recorded above its price — needs payment review before renewing"
    : newPrice != null && prepaid > Math.max(0, Number(newPrice)) + 0.004
      ? "paid-ahead money exceeds the new package price — needs payment review before renewing"
      : null;
  return {
    blocked,
    unpaidCarriedForward: unpaid,
    previousPackageOwed: Math.max(0, Number(state.previousPackageOwed ?? 0)) + unpaid,
    amountPaid: prepaid + Math.max(0, Number(paidNow ?? 0)),
    prepaidApplied: prepaid,
  };
}
