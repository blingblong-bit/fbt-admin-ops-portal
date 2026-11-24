// Profile "Next package" line: pure pre-fill + display. No money logic.
import type { ProfileRenewal } from "./upcoming-first-visit";

export type CurrentPackage = { totalVisits: number | null; price: number | null; packageName: string | null };
export type NextPackagePrefill = {
  visits: number | null; price: number | null; startYmd: string | null;
  fromBooking: boolean; paid: number; hasPrepared: boolean;
};

const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/** Priority: prepared renewal → booked future 1/x → current package (no date).
 *  When Square has a booked 1/x, its date is the start date — a stale stored
 *  prepared date never wins over the actual first visit. */
export function nextPackagePrefill(r: ProfileRenewal | null, cur: CurrentPackage | null): NextPackagePrefill | null {
  const prepared = r && r.kind !== "none" ? r.prepared : null;
  if (prepared) {
    const bookedYmd = r!.kind === "upcoming" ? r!.item.ymd : null;
    return { visits: pos(prepared.totalVisits), price: pos(prepared.price), startYmd: bookedYmd ?? prepared.startYmd,
      fromBooking: bookedYmd !== null, paid: prepared.paid, hasPrepared: true };
  }
  if (r?.kind === "upcoming") {
    return { visits: r.item.total_visits, price: pos(cur?.price), startYmd: r.item.ymd, fromBooking: true, paid: 0, hasPrepared: false };
  }
  const visits = pos(cur?.totalVisits), price = pos(cur?.price);
  if (visits == null && price == null) return null;
  return { visits, price, startYmd: null, fromBooking: false, paid: 0, hasPrepared: false };
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function nextPackageLine(p: NextPackagePrefill | null): string {
  if (!p) return "Next package: not set";
  const parts = [`${p.visits ?? "?"} visits`, p.price != null ? money(p.price) : "$?", p.startYmd ? `starts ${day(p.startYmd)}` : "start not set"];
  let s = `Next package: ${parts.join(" · ")}`;
  if (p.fromBooking && p.startYmd && p.visits) s += ` (1/${p.visits} booked)`;
  if (p.paid > 0) s += ` · paid ${money(p.paid)}`;
  return s;
}

export const chicagoToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
/** Today or earlier (Chicago) → renew now; future → prepare. */
export const startsNow = (startYmd: string, todayYmd: string) => startYmd <= todayYmd;
