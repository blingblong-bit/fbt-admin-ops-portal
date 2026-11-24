import type { SimpleClient, SimplePackage, SimplePayment } from "./simple-dues";

export type HistoryPayment = SimplePayment & { paidAt: string };
export type LastPayment = { date: string; amount: number };
export function daysBefore(date: string, days: number) {
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}
/** Receipt evidence only. Nothing returned here is an input to the balance calculator. */
export function simplePaymentEvidence(input: { clients: SimpleClient[]; completed: HistoryPayment[]; packages: SimplePackage[]; openings: {client_id: string; amount: number}[]; cutoverDate: string | null; fullHistory?: boolean }) {
  const completed = [...new Map(input.completed.filter(p => p.status === "COMPLETED").map(p => [p.id, p])).values()]
    .sort((a,b) => b.paidAt.localeCompare(a.paidAt) || b.id.localeCompare(a.id));
  const lastPayments: Record<string, LastPayment | null> = Object.fromEntries(input.clients.map(c => {
    const payment = completed.find(p => p.clientId === c.id);
    return [c.id, payment ? {date: payment.date, amount: payment.amountCents / 100} : null];
  }));
  const cutover = input.cutoverDate;
  const paymentHistory = completed.filter(p => !cutover || (p.date < cutover && (input.fullHistory || p.date >= daysBefore(cutover, 180))));
  const checkOpenings = !cutover ? [] : input.clients.filter(c => !c.archived).flatMap(client => {
    const opening = input.openings.find(o => o.client_id === client.id);
    if (!opening || opening.amount === 0) return [];
    const openingPackage = input.packages.filter(p => p.client_id === client.id && p.source === "opening" && !p.deleted_at)
      .sort((a,b) => b.started_on.localeCompare(a.started_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
    const hasEvidence = completed.some(p => p.clientId === client.id &&
      ((p.date >= daysBefore(cutover, 21) && p.date < cutover) || (!!openingPackage && p.date >= openingPackage.started_on)));
    return hasEvidence ? [{client, openingBalance: opening.amount, openingPackage, lastPayment: lastPayments[client.id] ?? null}] : [];
  }).sort((a,b) => a.client.name.localeCompare(b.client.name));
  return {paymentHistory, lastPayments, checkOpenings};
}