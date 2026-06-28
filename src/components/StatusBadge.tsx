import { simpleStatus, simpleStatusClasses, simpleStatusDot, type Client } from "@/lib/clients";

type Props = {
  client: Pick<Client, "package_total_visits" | "visits_used" | "package_price" | "amount_paid" | "is_scheduled">;
};

export function StatusBadge({ client }: Props) {
  const s = simpleStatus(client);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${simpleStatusClasses(s)}`}
    >
      <span aria-hidden>{simpleStatusDot(s)}</span>
      {s}
    </span>
  );
}
