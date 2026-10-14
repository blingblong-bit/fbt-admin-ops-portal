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

export type WeekOf = (ymd: string | null) => "this" | "next" | "later" | null;

/** Week bucket relative to the work week containing todayYmd. */
export function makeWeekOf(todayYmd: string, weekStart: (ymd: string) => string, addDays: (ymd: string, n: number) => string): WeekOf {
  const thisStart = weekStart(todayYmd);
  const nextStart = addDays(thisStart, 7);
  return (ymd) => {
    if (!ymd) return null;
    const w = weekStart(ymd);
    return w <= thisStart ? "this" : w === nextStart ? "next" : "later";
  };
}

/** Dollars for a filter, counting only the matching money buckets. Tiles and the page "Shown" line both use this. */
export function bucketDollars(r: MasterDuesRow, f: DuesFilter, weekOf: WeekOf): number {
  const ren = r.renewal.amount;
  switch (f) {
    case "all": return r.total;
    case "due_now": return r.previous.amount + r.current.amount + (r.renewal.status === "due_now" ? ren : 0);
    case "this_week": return (r.current.expected === "this_week" ? r.current.amount : 0) + (ren > 0 && weekOf(r.renewal.expected_ymd) === "this" ? ren : 0);
    case "next_week": return (r.current.expected === "next_week" ? r.current.amount : 0) + (ren > 0 && weekOf(r.renewal.expected_ymd) === "next" ? ren : 0);
    case "upcoming": return r.renewal.status === "upcoming" ? ren : 0;
    case "prepared": return r.renewal.status === "prepared" ? ren : 0;
    case "needs_review": return r.renewal.status === "needs_review" ? ren : 0;
  }
}

export function filterTotals(rows: MasterDuesRow[], f: DuesFilter, weekOf: WeekOf) {
  let clients = 0, dollars = 0;
  for (const r of rows) {
    if (!matchesFilter(r, f, weekOf)) continue;
    const d = bucketDollars(r, f, weekOf);
    if (d <= 0) continue;
    clients++; dollars += d;
  }
  return { clients, dollars: Math.round(dollars * 100) / 100 };
}
