// Pure filters for the Payment Due (Master Dues) page.
import type { MasterDuesRow } from "./master-dues";

export type DuesFilter = "all" | "due_now" | "this_week" | "next_week" | "upcoming" | "prepared" | "needs_review";

export const DUES_FILTERS: { key: DuesFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "due_now", label: "Due Now" },
  { key: "this_week", label: "This Week" },
  { key: "next_week", label: "Next Week" },
  { key: "upcoming", label: "Upcoming Renewals" },
  { key: "prepared", label: "Prepared / Unscheduled" },
  { key: "needs_review", label: "Needs Review" },
];

export function matchesFilter(r: MasterDuesRow, f: DuesFilter, weekOf: (ymd: string | null) => "this" | "next" | "later" | null): boolean {
  switch (f) {
    case "all": return true;
    case "due_now": return r.previous.amount > 0 || r.current.amount > 0 || r.renewal.status === "due_now";
    case "this_week": return r.current.expected === "this_week" || (r.renewal.amount > 0 && weekOf(r.renewal.expected_ymd) === "this");
    case "next_week": return r.current.expected === "next_week" || (r.renewal.amount > 0 && weekOf(r.renewal.expected_ymd) === "next");
    case "upcoming": return r.renewal.status === "upcoming";
    case "prepared": return r.renewal.status === "prepared";
    case "needs_review": return r.renewal.status === "needs_review";
  }
}

export const sumRows = (rows: MasterDuesRow[]) => Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100;
