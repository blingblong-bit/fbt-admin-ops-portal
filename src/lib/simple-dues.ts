/** Independent of Master Dues: money is integer cents, with no allocations. */
export type SimplePackage = { id: string; client_id: string; visits: number; price: number; started_on: string; source: "auto" | "manual" | "opening"; square_payment_id: string | null; flagged_for_review: boolean; reviewed_at: string | null; note: string | null; created_at: string; deleted_at: string | null };
export type SimplePayment = { id: string; clientId: string | null; amountCents: number; currency: string; status: string; date: string; buyerName?:string|null; buyerEmail?:string|null };
export type SimplePrice = { amount: number; visits: number; flag_for_review: boolean };
export type SimpleBooking = { id: string; clientId: string; date: string; startAt: string; endAt: string; status: string };
export type SimpleClient = { id: string; name: string; archived: boolean };
export const SIMPLE_DEFAULT_PRICES: SimplePrice[] = [
  { amount: 375, visits: 8, flag_for_review: false }, { amount: 345, visits: 8, flag_for_review: false },
  { amount: 200, visits: 4, flag_for_review: false }, { amount: 100, visits: 2, flag_for_review: true },
  { amount: 50, visits: 1, flag_for_review: true },
];
export function chicagoDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}
export function cents(amount: number): number { return Math.round(Number(amount) * 100); }
export function planAutoPackage(payment: SimplePayment, priceList: SimplePrice[], context: { cutoverDate: string | null; existingPaymentIds?: readonly string[] }) {
  if (!context.cutoverDate || payment.date < context.cutoverDate || payment.status !== "COMPLETED" || !payment.clientId || payment.currency !== "USD" || context.existingPaymentIds?.includes(payment.id)) return { kind: "ignore" as const };
  const match = priceList.find(p => cents(p.amount) === payment.amountCents);
  if (!match) return { kind: "check" as const, clientId: payment.clientId, paymentId: payment.id };
  return { kind: "add" as const, clientId: payment.clientId, paymentId: payment.id, visits: match.visits, price: payment.amountCents / 100, startedOn: payment.date, flaggedForReview: match.flag_for_review };
}
export function simpleBalance(opening: number, packages: SimplePackage[], payments: SimplePayment[], cutoverDate: string | null): number | null {
  if (!cutoverDate) return null;
  const prices = packages.filter(p => !p.deleted_at && p.source !== "opening" && p.started_on >= cutoverDate).reduce((sum, p) => sum + cents(p.price), 0);
  const unique = new Map(payments.map(p => [p.id, p]));
  const paid = [...unique.values()].filter(p => p.date >= cutoverDate && p.status === "COMPLETED" && p.currency === "USD").reduce((sum, p) => sum + p.amountCents, 0);
  return (cents(opening) + prices - paid) / 100;
}
export function newestSimplePackage(packages: SimplePackage[], cutover: string | null): SimplePackage | null {
  if (!cutover) return null;
  return packages.filter(p => !p.deleted_at).sort((a,b) => b.started_on.localeCompare(a.started_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
}
export function simpleVisitsLeft(pkg: SimplePackage, bookings: SimpleBooking[], now: string): number {
  return assignSimplePackages([pkg], bookings, now).visitsLeft ?? pkg.visits;
}
export type SimpleVisit = { booking: SimpleBooking; number: number; size: number; label: string; cycle: number; newPackage: boolean; price: number; recordedPackageId?: string | null };
/** Shared eligibility for reservation numbering and missing-package activity; not attendance certification. */
export function eligibleSimpleBookings(bookings: SimpleBooking[], now: string): SimpleBooking[] {
  return [...new Map(bookings.filter(b =>
    (b.endAt <= now && (b.status === "ACCEPTED" || b.status === "COMPLETED")) ||
    (b.startAt > now && b.status === "ACCEPTED")
  ).map(b => [b.id, b])).values()].sort((a,b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}
/** Packages take turns by capacity, never by the next payment date. No balance inputs or writes. */
export function assignSimplePackages(packages: SimplePackage[], bookings: SimpleBooking[], now: string) {
  const active = packages.filter(p => !p.deleted_at).sort((a,b) => a.started_on.localeCompare(b.started_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const first = active[0]; const last = active.at(-1);
  if (!first || !last) return { visits: [] as SimpleVisit[], visitsLeft: null };
  const eligible = eligibleSimpleBookings(bookings.filter(b => b.clientId === first.client_id && b.date >= first.started_on), now);
  const capacity = active.reduce((sum,p) => sum + p.visits, 0);
  // Upcoming reservations receive slots, but only ended bookings consume visits left.
  const visitsLeft = capacity - eligible.filter(b => b.endAt <= now).length;
  if (active.some(p => !Number.isInteger(p.visits) || p.visits < 0)) return { visits: [] as SimpleVisit[], visitsLeft };
  let packageIndex = 0; let used = 0;
  const visits: SimpleVisit[] = [];
  for (const booking of eligible) {
    while (active[packageIndex] && used >= (active[packageIndex]?.visits ?? 0)) { packageIndex++; used = 0; }
    const recorded = active[packageIndex];
    const p = recorded ?? last;
    if (p.visits <= 0) break;
    const number = used % p.visits + 1;
    const cycle = recorded ? packageIndex : active.length + Math.floor(used / p.visits);
    visits.push({ booking, number, size: p.visits, label: `${number}/${p.visits}`, cycle,
      newPackage: !recorded && number === 1, price: p.price, recordedPackageId: recorded?.id ?? null });
    used++;
  }
  return { visits, visitsLeft };
}
/** Read-only reservation projection, not attendance certification or a balance input. */
export function numberSimpleVisits(pkg: SimplePackage, bookings: SimpleBooking[], now: string): SimpleVisit[] {
  return assignSimplePackages([pkg], bookings, now).visits;
}
export type SimpleRenewal = { client: SimpleClient; visit: SimpleVisit; paid: boolean; expected: number; group: "This week" | "Next week" | "Later" };
export function simpleRenewalGroup(date: string, now: string): SimpleRenewal["group"] {
  // Monday–Sunday calendar weeks in Chicago, independent of UTC/DST offsets.
  const today = new Date(`${chicagoDate(now)}T12:00:00Z`);
  const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
  const day = Math.floor((new Date(`${date}T12:00:00Z`).getTime() - monday.getTime()) / 86400000);
  return day < 7 ? "This week" : day < 14 ? "Next week" : "Later";
}
export function nextSimpleRenewal(client: SimpleClient, visits: SimpleVisit[], packages: SimplePackage[], now: string): SimpleRenewal | null {
  const visit = visits.find(v => v.booking.startAt > now && isSimpleRenewalStart(v, packages));
  if (!visit) return null;
  const paid = !!visit.recordedPackageId;
  return { client, visit, paid, expected: paid ? 0 : visit.price, group: simpleRenewalGroup(visit.booking.date, now) };
}
function isSimpleRenewalStart(visit: SimpleVisit, packages: SimplePackage[]) {
  // The opening cycle is already represented by the opening balance, not new renewal value.
  return visit.number === 1 && (visit.newPackage || packages.some(p => p.id === visit.recordedPackageId && !p.deleted_at && (visit.cycle > 0 || p.source !== "opening")));
}
export type SimpleRow = { client: SimpleClient; balance: number | null; newest: SimplePackage | null; visitsLeft: number | null; next: SimpleBooking | null; unmatchedPaymentIds: string[]; upcomingVisits: SimpleVisit[]; renewal: SimpleRenewal | null };
export function simpleWeekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function shiftSimpleWeek(week: string, offset: number): string {
  const day = new Date(`${simpleWeekStart(week)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset * 7);
  return day.toISOString().slice(0, 10);
}
export type SimpleRenewalEvent = { client: SimpleClient; visit: SimpleVisit; paid: boolean; expected: number; packageId: string };
/** Current-record reconstruction only: no saved historical forecast or balance snapshots. */
export function simpleRenewalEvents(client: SimpleClient, packages: SimplePackage[], bookings: SimpleBooking[], now: string, cutover: string | null): SimpleRenewalEvent[] {
  if (!cutover || client.archived) return [];
  return renewalEventsFromAssignment(client, assignSimplePackages(packages.filter(p => p.client_id === client.id), bookings, now).visits, packages, cutover);
}
function renewalEventsFromAssignment(client: SimpleClient, visits: SimpleVisit[], packages: SimplePackage[], cutover: string): SimpleRenewalEvent[] {
  return visits.filter(v => v.booking.date >= cutover && isSimpleRenewalStart(v, packages)).map(visit => {
    const paid = !!visit.recordedPackageId;
    return { client, visit, paid, expected: paid ? 0 : visit.price, packageId: visit.recordedPackageId ?? `projected:${client.id}:${visit.cycle}` };
  });
}
export type SimpleRenewalWeekRow = { client: SimpleClient; carriedOver: number; newThisWeek: number; total: number; packages: SimpleRenewalEvent[]; carriedPackages: SimpleRenewalEvent[] };
/** Assumes no additional payments; carried projections never become stored balances. */
export function buildSimpleRenewalWeek(input: { events: SimpleRenewalEvent[]; whoOwes: SimpleRow[]; selectedDate: string; now: string; bookingsReliable?: boolean }) {
  const start = simpleWeekStart(input.selectedDate); const next = shiftSimpleWeek(start, 1);
  const endDate = new Date(`${next}T12:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() - 1);
  const currentStart = simpleWeekStart(chicagoDate(input.now));
  const isCurrent = start === currentStart; const isPast = start < currentStart;
  const seen = new Set<string>();
  const events = input.bookingsReliable === false ? [] : input.events.filter(r => {
    const key = `${r.client.id}:${r.visit.booking.id}`;
    if (r.client.archived || seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b) => a.visit.booking.startAt.localeCompare(b.visit.booking.startAt) || a.client.name.localeCompare(b.client.name));
  const packages = events.filter(r => r.visit.booking.date >= start && r.visit.booking.date < next);
  const owed = !isPast ? [...new Map(input.whoOwes.filter(r => !r.client.archived && r.balance !== null && r.balance > 0).map(r => [r.client.id, r])).values()] : [];
  const carriedPackages = isPast ? [] : events.filter(r => !r.paid && r.visit.booking.startAt > input.now && r.visit.booking.date < start);
  const byClient = new Map<string, { client: SimpleClient; carriedCents: number; newCents: number; packages: SimpleRenewalEvent[]; carriedPackages: SimpleRenewalEvent[] }>();
  function clientRow(client: SimpleClient) {
    const existing = byClient.get(client.id);
    if (existing) return existing;
    const row = { client, carriedCents: 0, newCents: 0, packages: [] as SimpleRenewalEvent[], carriedPackages: [] as SimpleRenewalEvent[] };
    byClient.set(client.id, row); return row;
  }
  for (const row of owed) clientRow(row.client).carriedCents += cents(Number(row.balance));
  for (const event of carriedPackages) {
    const row = clientRow(event.client); row.carriedCents += cents(event.expected); row.carriedPackages.push(event);
  }
  for (const event of packages) {
    const row = clientRow(event.client); row.newCents += event.paid ? 0 : cents(event.expected); row.packages.push(event);
  }
  const rows: SimpleRenewalWeekRow[] = [...byClient.values()].map(r => ({ client: r.client, carriedOver: r.carriedCents / 100, newThisWeek: r.newCents / 100, total: (r.carriedCents + r.newCents) / 100, packages: r.packages, carriedPackages: r.carriedPackages })).sort((a,b) => a.client.name.localeCompare(b.client.name));
  const newThisWeek = [...byClient.values()].reduce((s,r) => s + r.newCents, 0);
  const carriedOver = [...byClient.values()].reduce((s,r) => s + r.carriedCents, 0);
  return { start, end: endDate.toISOString().slice(0,10), isCurrent, isPast, packages, rows,
    newThisWeek: newThisWeek / 100, carriedOver: carriedOver / 100, total: (newThisWeek + carriedOver) / 100,
    expectedValue: packages.reduce((s,r) => s + cents(r.visit.price), 0) / 100,
    paidValue: packages.filter(r => r.paid).reduce((s,r) => s + cents(r.visit.price), 0) / 100,
    appointmentsReliable: input.bookingsReliable !== false,
  };
}
export function unlinkedSimplePayments(payments:SimplePayment[],cutoverDate:string|null) {
  if(!cutoverDate)return [];
  return [...new Map(payments.map(p=>[p.id,p])).values()].filter(p=>!p.clientId && p.status==="COMPLETED" && p.date>=cutoverDate).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export function computeSimpleDues(input: { clients: SimpleClient[]; packages: SimplePackage[]; payments: SimplePayment[]; bookings: SimpleBooking[]; openings: {client_id: string; amount: number}[]; priceList: SimplePrice[]; cutoverDate: string | null; now: string; bookingsReliable?: boolean }) {
  const assignments = new Map<string, SimpleVisit[]>();
  const rows: SimpleRow[] = input.clients.filter(c => !c.archived).map(client => {
    const packages = input.packages.filter(p => p.client_id === client.id);
    const payments = input.payments.filter(p => p.clientId === client.id);
    const bookings = input.bookings.filter(b => b.clientId === client.id);
    const newest = newestSimplePackage(packages, input.cutoverDate);
    const next = input.bookingsReliable === false ? null : bookings.filter(b => b.startAt > input.now && b.status === "ACCEPTED").sort((a,b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
    const known = packages.map(p => p.square_payment_id).filter((id): id is string => !!id);
    const assignment = newest && input.bookingsReliable !== false ? assignSimplePackages(packages, bookings, input.now) : { visits: [], visitsLeft: null };
    const numbered = assignment.visits;
    assignments.set(client.id, numbered);
    return { client, balance: simpleBalance(Number(input.openings.find(o => o.client_id === client.id)?.amount ?? 0), packages, payments, input.cutoverDate), newest,
      visitsLeft: assignment.visitsLeft, next,
      upcomingVisits: numbered.filter(v => v.booking.startAt > input.now), renewal: nextSimpleRenewal(client, numbered, packages, input.now),
      unmatchedPaymentIds: payments.filter(p => planAutoPackage(p, input.priceList, {cutoverDate: input.cutoverDate, existingPaymentIds: known}).kind === "check").map(p => p.id),
    };
  });
  const whoOwes = rows.filter(r => r.balance !== null && r.balance > 0).sort((a,b) => Number(b.balance) - Number(a.balance) || a.client.name.localeCompare(b.client.name));
  const checkPackageInfo = rows.filter(r => r.balance !== null && (r.balance < 0 || r.unmatchedPaymentIds.length > 0));
  const { renewSoon, inactiveRenewSoon } = groupSimpleRenewSoon(rows, input.bookings, input.now);
  const needsPackage = input.cutoverDate && input.bookingsReliable !== false ? findSimpleNeedsPackage(rows, input.packages, input.bookings, input.cutoverDate, input.now) : [];
  const cutover = input.cutoverDate;
  const flagged = cutover ? input.packages.filter(p => !p.deleted_at && p.started_on >= cutover && p.flagged_for_review && !p.reviewed_at && rows.some(r => r.client.id === p.client_id)) : [];
  const upcomingRenewals = rows.flatMap(r => r.renewal ? [r.renewal] : []).sort((a,b) => a.visit.booking.startAt.localeCompare(b.visit.booking.startAt) || a.client.name.localeCompare(b.client.name));
  const renewalExpected = { thisWeek: upcomingRenewals.filter(r => r.group === "This week").reduce((s,r) => s + cents(r.expected), 0) / 100, nextWeek: upcomingRenewals.filter(r => r.group === "Next week").reduce((s,r) => s + cents(r.expected), 0) / 100 };
  const renewalEvents = input.bookingsReliable === false ? [] : rows.flatMap(r => input.cutoverDate ? renewalEventsFromAssignment(r.client, assignments.get(r.client.id) ?? [], input.packages, input.cutoverDate) : []);
  return { rows, whoOwes, checkPackageInfo, renewSoon, inactiveRenewSoon, needsPackage, flagged, upcomingRenewals, renewalExpected, renewalEvents, totalOwed: whoOwes.reduce((sum,r) => sum + cents(Number(r.balance)), 0) / 100, owingCount: whoOwes.length };
}
export function findSimpleNeedsPackage(rows: SimpleRow[], packages: SimplePackage[], bookings: SimpleBooking[], cutover: string, now: string) {
  return rows.filter(r => !r.client.archived && !packages.some(p => p.client_id === r.client.id && !p.deleted_at)).flatMap(row => {
    const eligible = eligibleSimpleBookings(bookings.filter(b => b.clientId === row.client.id), now);
    const visitsSinceCutover = eligible.filter(b => b.endAt <= now && b.date >= cutover).length;
    return eligible.some(b => b.startAt > now) || visitsSinceCutover > 0 ? [{ ...row, visitsSinceCutover }] : [];
  }).sort((a,b) => (a.next?.startAt ?? "9999-12-31").localeCompare(b.next?.startAt ?? "9999-12-31") || a.client.name.localeCompare(b.client.name));
}
export function groupSimpleRenewSoon(rows: SimpleRow[], bookings: SimpleBooking[], now: string) {
  const cutoff = new Date(new Date(now).getTime() - 30 * 86400000).toISOString();
  const candidates = rows.filter(r => !r.client.archived && r.newest && r.visitsLeft !== null && (r.visitsLeft <= 2 || r.upcomingVisits[0]?.newPackage));
  const inactive = (r: SimpleRow) => r.visitsLeft === 0 && !r.next && !eligibleSimpleBookings(bookings.filter(b => b.clientId === r.client.id), now).some(b => b.endAt <= now && b.startAt >= cutoff);
  const priority = (r: SimpleRow) => Number(r.visitsLeft) < 0 ? 0 : r.visitsLeft === 0 ? 1 : 2;
  const sort = (a: SimpleRow,b: SimpleRow) => priority(a) - priority(b) || (a.next?.startAt ?? "9999-12-31").localeCompare(b.next?.startAt ?? "9999-12-31") || a.client.name.localeCompare(b.client.name);
  return { renewSoon: candidates.filter(r => !inactive(r)).sort(sort), inactiveRenewSoon: candidates.filter(inactive).sort(sort) };
}
export function simpleDuesAttentionCounts(board: { renewSoon: SimpleRow[]; inactiveRenewSoon: SimpleRow[]; needsPackage: SimpleRow[]; flagged: SimplePackage[] }) {
  return { renewSoon: board.renewSoon.length + board.inactiveRenewSoon.length, needsPackage: board.needsPackage.length, flagged: board.flagged.length };
}
/** CSV accepts quoted names, rejects ambiguous/unmatched clients and duplicate rows before any write. */
export function parseOpeningCsv(text: string, clients: SimpleClient[]): {client_id: string; amount: number; note: string}[] {
  const records: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i=0;i<text.length;i++) { const ch = text[i];
    if (ch === '"') { if (quoted && text[i+1] === '"') {cell+='"'; i++;} else quoted=!quoted; }
    else if (!quoted && (ch === ',' || ch === '\n')) { row.push(cell.trim()); cell=""; if(ch==='\n') {if(row.some(Boolean)) records.push(row); row=[];} }
    else if(ch !== '\r') cell+=ch;
  }
  if(quoted) throw new Error("Unclosed quote in CSV"); row.push(cell.trim()); if(row.some(Boolean)) records.push(row);
  if(records[0]?.[1]?.toLowerCase()==="amount") records.shift();
  const seen=new Set<string>();
  return records.map((r,i)=> { if(r.length!==2) throw new Error(`Row ${i+1}: expected client and amount`);
    const name=(r[0]??"").trim().toLowerCase(); const matches=clients.filter(c=>c.id.toLowerCase()===name || c.name.trim().toLowerCase()===name);
    const client=matches[0]; if(matches.length!==1 || !client) throw new Error(`Row ${i+1}: client name is missing, unknown or ambiguous; use client id`);
    if(seen.has(client.id)) throw new Error(`Row ${i+1}: duplicate client`); seen.add(client.id);
    const amount=Number(r[1]); if(!r[1] || !Number.isFinite(amount) || Math.abs(amount)>9999999999 || cents(amount)/100!==amount) throw new Error(`Row ${i+1}: invalid amount`);
    return {client_id:client.id,amount,note:"Opening balance CSV import"};
  });
}