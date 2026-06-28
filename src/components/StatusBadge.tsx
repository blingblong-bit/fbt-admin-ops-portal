import { computeStatus, statusClasses, type Client } from "@/lib/clients";

export function StatusBadge({ client }: { client: Pick<Client, "package_total_visits" | "visits_used" | "package_price" | "amount_paid"> }) {
  const s = computeStatus(client);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClasses(s)}`}>
      {s}
    </span>
  );
}
