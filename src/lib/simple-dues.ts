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
  // Square has no attendance-completed booking state: past ACCEPTED bookings whose full duration ended count.
  const completed = new Set(bookings.filter(b => b.clientId === pkg.client_id && b.date >= pkg.started_on && b.endAt <= now && (b.status === "ACCEPTED" || b.status === "COMPLETED")).map(b => b.id));
  return pkg.visits - completed.size;
}
export type SimpleVisit = { booking: SimpleBooking; number: number; size: number; label: string; cycle: number; newPackage: boolean; price: number };
/** Read-only reservation projection, not attendance certification or a balance input. */
export function numberSimpleVisits(pkg: SimplePackage, bookings: SimpleBooking[], now: string): SimpleVisit[] {
  if (!Number.isInteger(pkg.visits) || pkg.visits <= 0 || pkg.deleted_at) return [];
  const eligible = [...new Map(bookings.filter(b => b.clientId === pkg.client_id && b.date >= pkg.started_on &&
    ((b.endAt <= now && (b.status === "ACCEPTED" || b.status === "COMPLETED")) || (b.startAt > now && b.status === "ACCEPTED"))).map(b => [b.id, b])).values()];
  eligible.sort((a, b) => Number(a.startAt > now) - Number(b.startAt > now) || a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  return eligible.map((booking, index) => {
    const number = index % pkg.visits + 1; const cycle = Math.floor(index / pkg.visits);
    return { booking, number, size: pkg.visits, label: `${number}/${pkg.visits}`, cycle, newPackage: cycle > 0 && number === 1, price: pkg.price };
  });
}
export type SimpleRenewal = { client: SimpleClient; visit: SimpleVisit; paid: boolean; expected: number; group: "This week" | "Next week" | "Later" };
export function simpleRenewalGroup(date: string, now: string): SimpleRenewal["group"] {
  // Monday–Sunday calendar weeks in Chicago, independent of UTC/DST offsets.
  const today = new Date(`${chicagoDate(now)}T12:00:00Z`);
  const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
  const day = Math.floor((new Date(`${date}T12:00:00Z`).getTime() - monday.getTime()) / 86400000);
  return day < 7 ? "This week" : day < 14 ? "Next week" : "Later";
}
export function nextSimpleRenewal(client: SimpleClient, visits: SimpleVisit[], packages: SimplePackage[], now: string, anchor?: SimplePackage): SimpleRenewal | null {
  const prepaidAnchor = anchor?.source === "auto" && !!anchor.square_payment_id;
  // A recorded future package/early automatic purchase may already cover the first reserved cycle.
  const visit = visits.find(v => v.booking.startAt > now && (v.newPackage || (v.cycle === 0 && v.number === 1 && anchor && (anchor.started_on > chicagoDate(now) || prepaidAnchor))));
  if (!visit) return null;
  // Only a recorded package covering this boundary is evidence; an old receipt/negative balance is not prepayment.
  const paid = (visit.cycle === 0 && prepaidAnchor) || packages.some(p => p.client_id === client.id && !p.deleted_at && p.started_on >= visit.booking.date && p.visits === visit.size && cents(p.price) === cents(visit.price));
  return { client, visit, paid, expected: paid ? 0 : visit.price, group: simpleRenewalGroup(visit.booking.date, now) };
}
export type SimpleRow = { client: SimpleClient; balance: number | null; newest: SimplePackage | null; visitsLeft: number | null; next: SimpleBooking | null; unmatchedPaymentIds: string[]; upcomingVisits: SimpleVisit[]; renewal: SimpleRenewal | null };
export function unlinkedSimplePayments(payments:SimplePayment[],cutoverDate:string|null) {
  if(!cutoverDate)return [];
  return [...new Map(payments.map(p=>[p.id,p])).values()].filter(p=>!p.clientId && p.status==="COMPLETED" && p.date>=cutoverDate).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export function computeSimpleDues(input: { clients: SimpleClient[]; packages: SimplePackage[]; payments: SimplePayment[]; bookings: SimpleBooking[]; openings: {client_id: string; amount: number}[]; priceList: SimplePrice[]; cutoverDate: string | null; now: string; bookingsReliable?: boolean }) {
  const rows: SimpleRow[] = input.clients.filter(c => !c.archived).map(client => {
    const packages = input.packages.filter(p => p.client_id === client.id);
    const payments = input.payments.filter(p => p.clientId === client.id);
    const bookings = input.bookings.filter(b => b.clientId === client.id);
    const newest = newestSimplePackage(packages, input.cutoverDate);
    const next = input.bookingsReliable === false ? null : bookings.filter(b => b.startAt > input.now && b.status === "ACCEPTED").sort((a,b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
    const known = packages.map(p => p.square_payment_id).filter((id): id is string => !!id);
    const numbered = newest && input.bookingsReliable !== false ? numberSimpleVisits(newest, bookings, input.now) : [];
    return { client, balance: simpleBalance(Number(input.openings.find(o => o.client_id === client.id)?.amount ?? 0), packages, payments, input.cutoverDate), newest,
      visitsLeft: newest && input.bookingsReliable !== false ? simpleVisitsLeft(newest, bookings, input.now) : null, next,
      upcomingVisits: numbered.filter(v => v.booking.startAt > input.now), renewal: nextSimpleRenewal(client, numbered, packages, input.now, newest ?? undefined),
      unmatchedPaymentIds: payments.filter(p => planAutoPackage(p, input.priceList, {cutoverDate: input.cutoverDate, existingPaymentIds: known}).kind === "check").map(p => p.id),
    };
  });
  const whoOwes = rows.filter(r => r.balance !== null && r.balance > 0).sort((a,b) => Number(b.balance) - Number(a.balance) || a.client.name.localeCompare(b.client.name));
  const checkPackageInfo = rows.filter(r => r.balance !== null && (r.balance < 0 || r.unmatchedPaymentIds.length > 0));
  const renewSoon = rows.filter(r => r.newest && r.visitsLeft !== null && r.visitsLeft <= 2);
  const cutover = input.cutoverDate;
  const flagged = cutover ? input.packages.filter(p => !p.deleted_at && p.started_on >= cutover && p.flagged_for_review && !p.reviewed_at && rows.some(r => r.client.id === p.client_id)) : [];
  const upcomingRenewals = rows.flatMap(r => r.renewal ? [r.renewal] : []).sort((a,b) => a.visit.booking.startAt.localeCompare(b.visit.booking.startAt) || a.client.name.localeCompare(b.client.name));
  const renewalExpected = { thisWeek: upcomingRenewals.filter(r => r.group === "This week").reduce((s,r) => s + cents(r.expected), 0) / 100, nextWeek: upcomingRenewals.filter(r => r.group === "Next week").reduce((s,r) => s + cents(r.expected), 0) / 100 };
  return { rows, whoOwes, checkPackageInfo, renewSoon, flagged, upcomingRenewals, renewalExpected, totalOwed: whoOwes.reduce((sum,r) => sum + cents(Number(r.balance)), 0) / 100, owingCount: whoOwes.length };
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