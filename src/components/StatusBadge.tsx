import { simpleStatus, simpleStatusClasses, simpleStatusDot, type Client } from "@/lib/clients";

type Props = {
  client: Pick<Client, "package_total_visits" | "visits_used" | "package_price" | "amount_paid"> &
    Partial<
      Pick<
        Client,
        | "payment_model"
        | "previous_package_owed"
        | "pending_renewal_start_date"
        | "pending_renewal_price"
        | "pending_renewal_total_visits"
      >
    >;
  /** Derived from live Square bookings — pass false if unknown/not scheduled. */
  isScheduled: boolean;
  /** Staff dismissed this client with "No package needed". */
  dismissedFromPackageReview?: boolean;
};

export function StatusBadge({ client, isScheduled, dismissedFromPackageReview = false }: Props) {
  const s = simpleStatus(client, isScheduled, dismissedFromPackageReview);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${simpleStatusClasses(s)}`}
    >
      <span aria-hidden>{simpleStatusDot(s)}</span>
      {s}
    </span>
  );
}
