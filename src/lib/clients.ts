export type ClientStatus = "Completed" | "Payment Due" | "Ending Soon" | "Active";
export type SimpleStatus = "Payment Due" | "Not Scheduled" | "Active" | "Package Complete";
export type PrimaryActionKind = "record_payment" | "mark_scheduled" | "renew_package" | "view_client";
export type LifecycleStatus = "active" | "assessment" | "archived";

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
  visits_used: number | null;
  amount_paid: number;
  internal_notes: string | null;
  square_visit_note: string | null;
  status: LifecycleStatus | string;
  manual_active: boolean;
  square_customer_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}


export interface ClientActivity {
  id: string;
  client_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function hasVisitTracking(c: Pick<Client, "visits_used">) {
  return c.visits_used !== null && c.visits_used !== undefined;
}

export function visitsRemaining(c: Pick<Client, "package_total_visits" | "visits_used">): number | null {
  if (c.visits_used === null || c.visits_used === undefined) return null;
  return Math.max(0, (c.package_total_visits ?? 0) - c.visits_used);
}

export function amountOwed(c: Pick<Client, "package_price" | "amount_paid">) {
  return Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
}

export function computeStatus(
  c: Pick<Client, "package_total_visits" | "visits_used" | "package_price" | "amount_paid">,
): ClientStatus {
  const remaining = visitsRemaining(c);
  const owed = amountOwed(c);
  if (remaining !== null && c.package_total_visits > 0 && remaining === 0) return "Completed";
  if (owed > 0) return "Payment Due";
  if (remaining !== null && remaining <= 2) return "Ending Soon";
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

type SimpleClient = Pick<
  Client,
  "package_total_visits" | "visits_used" | "package_price" | "amount_paid"
>;

/**
 * Schedule status is derived entirely from live Square bookings. Callers must
 * pass `isScheduled` based on the current Square booking window.
 */
export function simpleStatus(c: SimpleClient, isScheduled: boolean): SimpleStatus {
  const owed = amountOwed(c);
  const remaining = visitsRemaining(c);
  if (remaining !== null && c.package_total_visits > 0 && remaining === 0) return "Package Complete";
  if (owed > 0) return "Payment Due";
  if (!isScheduled) return "Not Scheduled";
  return "Active";
}

/**
 * Effective lifecycle classification (Active / Assessment / Archived).
 * Derived live from package state + live Square booking + manual pin.
 * Does NOT trust c.status alone — that column is just the persisted default.
 */
export function effectiveStatus(
  c: Pick<
    Client,
    | "package_total_visits"
    | "visits_used"
    | "package_price"
    | "amount_paid"
    | "manual_active"
    | "status"
  >,
  isScheduled: boolean,
): LifecycleStatus {
  if (c.status === "archived") return "archived";
  if (c.manual_active) return "active";
  const owed = amountOwed(c);
  const remaining = visitsRemaining(c);
  const visitsLeft = remaining ?? 0;
  if (visitsLeft > 0 || owed > 0) return "active";
  if (isScheduled) {
    return (c.package_total_visits ?? 0) > 0 ? "active" : "assessment";
  }
  if (c.status === "assessment") return "assessment";
  return "active";
}


export function simpleStatusClasses(s: SimpleStatus): string {
  switch (s) {
    case "Active":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Payment Due":
      return "bg-red-100 text-red-800 border-red-200";
    case "Not Scheduled":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Package Complete":
      return "bg-slate-200 text-slate-700 border-slate-300";
  }
}

export function simpleStatusDot(s: SimpleStatus): string {
  switch (s) {
    case "Active":
      return "🟢";
    case "Payment Due":
      return "🔴";
    case "Not Scheduled":
      return "🟡";
    case "Package Complete":
      return "⚫";
  }
}

export function primaryAction(c: SimpleClient, isScheduled: boolean): PrimaryActionKind {
  const owed = amountOwed(c);
  const remaining = visitsRemaining(c);
  if (remaining !== null && c.package_total_visits > 0 && remaining === 0) return "renew_package";
  if (owed > 0) return "record_payment";
  if (!isScheduled) return "mark_scheduled";
  return "view_client";
}


export function fullName(c: Pick<Client, "first_name" | "last_name">) {
  return `${c.first_name} ${c.last_name}`.trim();
}

export function formatCurrency(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function progress(c: Pick<Client, "package_total_visits" | "visits_used">): string {
  if (c.visits_used === null || c.visits_used === undefined) return "—";
  return `${c.visits_used} / ${c.package_total_visits}`;
}

/**
 * Format an ISO datetime string in the user's local timezone as MM/DD/YYYY, h:mm AM/PM.
 * Returns "—" for null/empty values.
 */
export function formatDateTimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const dt = new Date(isoString);
  if (isNaN(dt.getTime())) return "—";
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month}/${day}/${year}, ${hours}:${minutes} ${ampm}`;
}

/**
 * Format an ISO date string (YYYY-MM-DD) or any Date-parseable value as MM/DD/YYYY.
 * Returns "—" for null/empty values.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  let y: number, m: number, d: number;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    // Parse as local date to avoid timezone shifts on YYYY-MM-DD strings.
    [y, m, d] = value.slice(0, 10).split("-").map(Number);
  } else {
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return "—";
    y = dt.getFullYear();
    m = dt.getMonth() + 1;
    d = dt.getDate();
  }
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

/**
 * Apple Notes import year rule: months 1–10 → 2026, months 11–12 → 2025.
 * Accepts "M/D", "MM/DD", "M/D/YY", etc., and returns an ISO YYYY-MM-DD string,
 * or null if it can't parse.
 */
export function importedAppleNotesDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = month >= 11 ? 2025 : 2026;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
