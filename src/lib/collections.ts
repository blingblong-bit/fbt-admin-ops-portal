/**
 * Collections Hub: front-desk view over Weekly Dues items. Pure, display only.
 * Every Master Dues dollar lands in exactly one money group, so the four
 * summary cards add up to the Master Dues total and never double count:
 *   thisWeek  = Weekly "expected" (scheduled Mon–Fri this week)
 *   pastDue   = Weekly "carryover" + "older" (collectible now, no visit this week)
 *   upcoming  = not yet due (future/prepared renewals, later billing)
 *   review    = renewal amounts Master Dues marks needs_review (not collectible yet)
 * Exceptions (missing price, billing setup) carry no dollars and are listed only.
 */
import type { MasterDuesException, MasterDuesRow } from "./master-dues";
import { computeWeeklyDues, KIND_LABEL, type WeeklyItem } from "./weekly-dues";

export type CollectionGroup = "thisWeek" | "pastDue" | "upcoming" | "review";
export type CollectionItem = WeeklyItem & { group: CollectionGroup; label: string; action: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

function groupOf(i: WeeklyItem, row: MasterDuesRow | undefined): CollectionGroup {
  if (i.section === "expected") return "thisWeek";
  if (i.section === "carryover" || i.section === "older") return "pastDue";
  if (i.kind === "renewal" && row?.renewal.status === "needs_review") return "review";
  return "upcoming";
}

function actionFor(i: WeeklyItem, g: CollectionGroup, row: MasterDuesRow | undefined): string {
  if (g === "thisWeek") return "Collect at this week's visit";
  if (g === "pastDue") return i.section === "carryover" ? "Collect — unpaid from last week" : "Collect or follow up — no visit this week";
  if (g === "review") return "Check package info on profile before collecting";
  if (i.kind === "renewal" && row?.renewal.status === "prepared") return "Not due yet — no new package start scheduled";
  return "Not due yet";
}

export function computeCollections(
  rows: MasterDuesRow[],
  appointments: Record<string, string[]>,
  exceptions: MasterDuesException[],
  weekStartYmd: string,
) {
  const w = computeWeeklyDues(rows, appointments, weekStartYmd);
  const byId = new Map(rows.map((r) => [r.client_id, r]));
  const items: CollectionItem[] = w.items.map((i) => {
    const row = byId.get(i.client_id);
    const group = groupOf(i, row);
    return { ...i, group, label: KIND_LABEL[i.kind], action: actionFor(i, group, row) };
  });
  const tot = (g: CollectionGroup) => {
    const xs = items.filter((i) => i.group === g);
    return { dollars: r2(xs.reduce((a, i) => a + i.amount, 0)), clients: new Set(xs.map((i) => i.client_id)).size };
  };
  const totals = { thisWeek: tot("thisWeek"), pastDue: tot("pastDue"), upcoming: tot("upcoming"), review: tot("review") };
  const sum = r2(totals.thisWeek.dollars + totals.pastDue.dollars + totals.upcoming.dollars + totals.review.dollars);
  const masterTotal = w.totals.masterTotal;
  return {
    week: w.week,
    items,
    exceptions,
    totals: { ...totals, sum, masterTotal, unexplained: r2(masterTotal - sum) },
  };
}

/** Groups items by client for display (one row per client per tab). */
export function byClient(items: CollectionItem[]) {
  const m = new Map<string, CollectionItem[]>();
  for (const i of items) m.set(i.client_id, [...(m.get(i.client_id) ?? []), i]);
  return [...m.values()]
    .map((g) => ({ client_id: g[0].client_id, name: g[0].name, amount: r2(g.reduce((a, i) => a + i.amount, 0)), items: g }))
    .sort((a, b) => (a.items[0].ymd ?? "9999").localeCompare(b.items[0].ymd ?? "9999") || a.name.localeCompare(b.name));
}
