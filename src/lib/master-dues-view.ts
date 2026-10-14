// Pure filters for the Payment Due (Master Dues) page.
import type { MasterDuesRow } from "./master-dues";

export type DuesFilter = "all" | "due_now" | "this_week" | "next_week" | "upcoming" | "prepared" | "needs_review" | "carryover";

export const DUES_FILTERS: { key: DuesFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "due_now", label: "Due Now" },
  { key: "this_week", label: "This Week" },
  { key: "next_week", label: "Next Week" },
  { key: "carryover", label: "Carryover / Prior Week Unpaid" },
  { key: "upcoming", label: "Upcoming Renewals" },
  { key: "prepared", label: "Prepared / Unscheduled" },
  { key: "needs_review", label: "Needs Review" },
];

export function matchesFilter(r: MasterDuesRow, f: DuesFilter, weekOf: (ymd: string | null) => "this" | "next" | "later" | null): boolean {
  switch (f) {
    case "all": return true;
    case "due_now": return r.previous.amount > 0 || r.current.amount > 0 || r.renewal.status === "due_now" || r.billing.due_now > 0;
    case "carryover": return r.billing.carryover > 0;
    case "this_week": return r.billing.this_week > 0 || r.current.expected === "this_week" || (r.renewal.amount > 0 && weekOf(r.renewal.expected_ymd) === "this");
    case "next_week": return r.billing.next_week > 0 || r.current.expected === "next_week" || (r.renewal.amount > 0 && weekOf(r.renewal.expected_ymd) === "next");
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
    case "due_now": return r.previous.amount + r.current.amount + (r.renewal.status === "due_now" ? ren : 0) + r.billing.due_now;
    case "carryover": return r.billing.carryover;
    case "this_week": return (r.current.expected === "this_week" ? r.current.amount : 0) + (ren > 0 && weekOf(r.renewal.expected_ymd) === "this" ? ren : 0) + r.billing.this_week;
    case "next_week": return (r.current.expected === "next_week" ? r.current.amount : 0) + (ren > 0 && weekOf(r.renewal.expected_ymd) === "next" ? ren : 0) + r.billing.next_week;
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

/** Rank of a row's highest-priority open bucket (lower = first). Display only. */
export function rowRank(r: MasterDuesRow, weekOf: WeekOf): { rank: number; ymd: string } {
  const ren = r.renewal.amount > 0;
  const renWk = ren ? weekOf(r.renewal.expected_ymd) : null;
  if (r.previous.amount > 0 || r.current.amount > 0 || r.billing.due_now > 0 || r.renewal.status === "due_now") {
    const past = r.billing.obligations.filter((o) => o.status === "due_now").map((o) => o.ymd).sort()[0];
    return { rank: 1, ymd: past ?? (r.renewal.status === "due_now" ? r.renewal.expected_ymd ?? "" : "") };
  }
  const wk = r.billing.obligations.map((o) => o.ymd).sort()[0] ?? "";
  if (r.billing.this_week > 0 || (ren && renWk === "this")) return { rank: 2, ymd: (ren && renWk === "this" ? r.renewal.expected_ymd : wk) ?? "" };
  if (r.billing.next_week > 0 || (ren && renWk === "next")) return { rank: 3, ymd: (ren && renWk === "next" ? r.renewal.expected_ymd : wk) ?? "" };
  if (r.renewal.status === "upcoming") return { rank: 4, ymd: r.renewal.expected_ymd ?? "" };
  if (r.renewal.status === "prepared") return { rank: 5, ymd: "" };
  return { rank: 6, ymd: r.renewal.expected_ymd ?? "" };
}

export function sortRows(rows: MasterDuesRow[], weekOf: WeekOf): MasterDuesRow[] {
  const k = new Map(rows.map((r) => [r.client_id, rowRank(r, weekOf)]));
  return [...rows].sort((a, b) => {
    const x = k.get(a.client_id)!, y = k.get(b.client_id)!;
    if (x.rank !== y.rank) return x.rank - y.rank;
    const xd = x.ymd || "9999", yd = y.ymd || "9999";
    if (xd !== yd) return xd < yd ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
