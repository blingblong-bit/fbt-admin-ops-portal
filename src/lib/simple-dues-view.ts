import { assignSimplePackages, type SimpleBooking, type SimplePackage, type SimpleRow } from "./simple-dues";

export const DUES_LISTS = ["who-owes", "needs-package", "flagged", "check-package-info", "renew-soon", "upcoming-renewals", "check-openings"] as const;
export type DuesList = typeof DUES_LISTS[number];
export function selectedDuesList(value: string): DuesList | null {
  return DUES_LISTS.find(list => list === value) ?? null;
}
export function duesTileCounts(board: { whoOwes: SimpleRow[]; needsPackage: SimpleRow[]; flagged: SimplePackage[]; checkPackageInfo: SimpleRow[]; unlinkedPayments: unknown[]; renewSoon: SimpleRow[]; inactiveRenewSoon: SimpleRow[] }, week: { rows: unknown[] }) {
  return { "who-owes": board.whoOwes.length, "needs-package": board.needsPackage.length, flagged: board.flagged.length,
    "check-package-info": board.checkPackageInfo.length + board.unlinkedPayments.length,
    "renew-soon": board.renewSoon.length + board.inactiveRenewSoon.length, "upcoming-renewals": week.rows.length };
}

/** Display only: select the current capacity bucket without using any balance or legacy fields. */
export function simpleCurrentPackage(packages: SimplePackage[], bookings: SimpleBooking[], now: string, reliable: boolean) {
  const active = packages.filter(p => !p.deleted_at).sort((a,b) => a.started_on.localeCompare(b.started_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  if (!reliable) return { package: null, totalVisits: null, visitsLeft: null, nextStart: null, reliable: false };
  const { visits, visitsLeft } = assignSimplePackages(active, bookings, now);
  const latest = visits.filter(v => v.booking.endAt <= now).at(-1) ?? visits.find(v => v.booking.startAt > now);
  const current = active.find(p => p.id === latest?.recordedPackageId) ?? active.at(-1) ?? null;
  const remaining = latest ? latest.size - (latest.booking.endAt <= now ? latest.number : latest.number - 1) : visitsLeft;
  return { package: current, totalVisits: latest?.size ?? current?.visits ?? null, visitsLeft: current ? Math.max(0, latest?.recordedPackageId ? Number(remaining) : Number(visitsLeft)) : null,
    nextStart: visits.find(v => v.number === 1 && v.booking.startAt > now) ?? null, reliable: true };
}