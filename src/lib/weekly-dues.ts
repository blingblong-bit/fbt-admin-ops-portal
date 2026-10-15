/**
 * Weekly Dues: slices Master Dues rows into one selected Mon–Fri work week.
 * Pure — no I/O. Every open dollar of every row lands in exactly one bucket:
 * expected (this week), carryover (prior work week), older, or excluded
 * (not actionable this week: future/prepared/needs-review renewals, later
 * forecast). shown + excluded always equals the Master Dues total.
 *
 * Carryover is live: it reads current open amounts, so payments made before
 * the prior week closes shrink it automatically. Nothing is snapshotted.
 */
import type { MasterDuesRow } from "./master-dues";
import { addDaysYmd, workWeekStartFromYmd } from "./work-week";

export type WeeklyKind = "current" | "renewal" | "ppv" | "weekly" | "previous";
export type WeeklySection = "expected" | "carryover" | "older" | "excluded";
export type WeeklyItem = {
  client_id: string;
  name: string;
  kind: WeeklyKind;
  section: WeeklySection;
  amount: number;
  ymd: string | null;
  time_iso: string | null;
  reason: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const chi = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export const KIND_LABEL: Record<WeeklyKind, string> = {
  current: "Current Balance", renewal: "Renewal", ppv: "PPV", weekly: "Weekly", previous: "Previous Package",
};

export function computeWeeklyDues(
  rows: MasterDuesRow[],
  appointments: Record<string, string[]>,
  weekStartYmd: string,
) {
  const W = workWeekStartFromYmd(weekStartYmd);
  const P = addDaysYmd(W, -7);
  const end = addDaysYmd(W, 4);
  const wk = (ymd: string) => workWeekStartFromYmd(ymd);
  const items: WeeklyItem[] = [];

  for (const r of rows) {
    const add = (kind: WeeklyKind, section: WeeklySection, amount: number, ymd: string | null, reason: string, time_iso: string | null = null) => {
      if (amount > 0) items.push({ client_id: r.client_id, name: r.name, kind, section, amount: r2(amount), ymd, time_iso, reason });
    };
    const inWeek = (appointments[r.client_id] ?? []).filter((iso) => wk(chi(iso)) === W).sort();

    add("previous", "older", r.previous.amount, null, "Debt from an earlier package");

    if (r.current.amount > 0) {
      if (inWeek[0]) add("current", "expected", r.current.amount, chi(inWeek[0]), "Current balance; appointment this week", inWeek[0]);
      else add("current", "older", r.current.amount, null, "Current balance; no appointment this week");
    }

    if (r.renewal.amount > 0) {
      const y = r.renewal.expected_ymd;
      const st = r.renewal.status;
      const live = st === "due_now" || st === "upcoming";
      if (live && y && wk(y) === W) {
        const t = inWeek.find((iso) => chi(iso) === y) ?? null;
        add("renewal", "expected", r.renewal.amount, y, st === "due_now" ? "New package started this week" : "First uncovered appointment this week", t);
      } else if (st === "due_now" && y && wk(y) === P) add("renewal", "carryover", r.renewal.amount, y, "New package started last week; unpaid");
      else if (st === "due_now") add("renewal", "older", r.renewal.amount, y, "New package already started; unpaid");
      else add("renewal", "excluded", r.renewal.amount, y, `Renewal ${st} — not due this week`);
    }

    // Billing: only the dollars Master Dues counted (needs_billing_review excluded there too).
    for (const o of r.billing.obligations) {
      if (o.status === "needs_billing_review" || o.open <= 0) continue;
      const kind: WeeklyKind = o.kind === "week" ? "weekly" : "ppv";
      const ow = wk(o.ymd);
      const label = o.kind === "week" ? "Weekly billing" : "Per-visit charge";
      if (ow === W) {
        const t = o.kind === "visit" ? inWeek.find((iso) => chi(iso) === o.ymd) ?? null : null;
        add(kind, "expected", o.open, o.ymd, `${label} this week`, t);
      } else if (ow === P) add(kind, "carryover", o.open, o.ymd, `${label} from last week; unpaid`);
      else if (ow < P) add(kind, "older", o.open, o.ymd, `${label} from an earlier week; unpaid`);
      else add(kind, "excluded", o.open, o.ymd, `${label} after the selected week`);
    }
  }

  const sum = (s: WeeklySection) => r2(items.filter((i) => i.section === s).reduce((a, i) => a + i.amount, 0));
  const count = (s: WeeklySection) => new Set(items.filter((i) => i.section === s).map((i) => i.client_id)).size;
  const expected = sum("expected"), carryover = sum("carryover"), older = sum("older"), excluded = sum("excluded");
  const masterTotal = r2(rows.reduce((a, r) => a + r.total, 0));
  const total = r2(expected + carryover + older);
  return {
    week: { start: W, end, priorStart: P },
    items,
    totals: {
      expected, carryover, older, total, excluded,
      expectedClients: count("expected"), carryoverClients: count("carryover"), olderClients: count("older"),
      masterTotal,
      unexplained: r2(masterTotal - total - excluded),
    },
  };
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export function weekdayIndex(weekStart: string, ymd: string | null): number {
  if (!ymd) return 0;
  for (let i = 0; i < 5; i++) if (addDaysYmd(weekStart, i) === ymd) return i;
  return 0;
}

export type WeeklyFilter = "all" | "mon" | "tue" | "wed" | "thu" | "fri" | "carryover" | "older" | "renewal" | "current" | "billing";
export const WEEKLY_FILTERS: { key: WeeklyFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" }, { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" },
  { key: "carryover", label: "Carryover" }, { key: "older", label: "Older Outstanding" },
  { key: "renewal", label: "Renewal" }, { key: "current", label: "Current Balance" }, { key: "billing", label: "PPV / Weekly" },
];
const DAY: Partial<Record<WeeklyFilter, number>> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
export function matchesWeekly(i: WeeklyItem, f: WeeklyFilter, weekStart: string): boolean {
  if (i.section === "excluded") return false;
  if (f === "all") return true;
  if (f in DAY) return i.section === "expected" && weekdayIndex(weekStart, i.ymd) === DAY[f];
  if (f === "carryover" || f === "older") return i.section === f;
  if (f === "renewal") return i.kind === "renewal";
  if (f === "current") return i.kind === "current";
  return i.kind === "ppv" || i.kind === "weekly";
}
