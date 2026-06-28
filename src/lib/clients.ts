export type ClientStatus = "Completed" | "Payment Due" | "Ending Soon" | "Active";

export interface Client {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  package_name: string | null;
  package_total_visits: number;
  package_price: number;
  package_start_date: string | null;
  visits_used: number;
  amount_paid: number;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientActivity {
  id: string;
  client_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function visitsRemaining(c: Pick<Client, "package_total_visits" | "visits_used">) {
  return Math.max(0, (c.package_total_visits ?? 0) - (c.visits_used ?? 0));
}

export function amountOwed(c: Pick<Client, "package_price" | "amount_paid">) {
  return Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
}

export function computeStatus(c: Pick<Client, "package_total_visits" | "visits_used" | "package_price" | "amount_paid">): ClientStatus {
  const remaining = visitsRemaining(c);
  const owed = amountOwed(c);
  if (c.package_total_visits > 0 && remaining === 0) return "Completed";
  if (owed > 0) return "Payment Due";
  if (remaining <= 2) return "Ending Soon";
  return "Active";
}

export function statusClasses(s: ClientStatus): string {
  switch (s) {
    case "Active":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Payment Due":
      return "bg-red-100 text-red-800 border-red-200";
    case "Ending Soon":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Completed":
      return "bg-slate-200 text-slate-700 border-slate-300";
  }
}

export function fullName(c: Pick<Client, "first_name" | "last_name">) {
  return `${c.first_name} ${c.last_name}`.trim();
}

export function formatCurrency(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function progress(c: Pick<Client, "package_total_visits" | "visits_used">) {
  return `${c.visits_used} / ${c.package_total_visits}`;
}
