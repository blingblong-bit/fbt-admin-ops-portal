/** Browser-safe, disposable scheduling data. Never import production services here. */
export const DEMO_DATE = '2026-11-09';
export const demoTrainers = ['Avery', 'Jordan', 'Casey'] as const;
export type DemoTrainer = typeof demoTrainers[number];
export type DemoClient = { id: string; name: string; total: number; used: number; price: number; paid: number };
export type DemoAppointment = { id: string; clientId: string; trainer: DemoTrainer; date: string; start: number; duration: number; status: 'booked' | 'completed' | 'cancelled'; completedVisit?: number };
export type DemoState = { clients: DemoClient[]; appointments: DemoAppointment[] };
export function initialDemoState(): DemoState {
  const clients: DemoClient[] = [
    { id: 'demo-1', name: 'Morgan Reed', total: 8, used: 2, price: 375, paid: 375 },
    { id: 'demo-2', name: 'Taylor Brooks', total: 4, used: 0, price: 200, paid: 0 },
    { id: 'demo-3', name: 'Alex Rivera', total: 8, used: 5, price: 375, paid: 100 },
    { id: 'demo-4', name: 'Jamie Quinn', total: 2, used: 0, price: 100, paid: 100 },
    { id: 'demo-5', name: 'Sam Ellis', total: 1, used: 0, price: 50, paid: 0 },
    { id: 'demo-6', name: 'Riley Park', total: 4, used: 1, price: 200, paid: 200 },
    { id: 'demo-7', name: 'Drew Lane', total: 8, used: 0, price: 375, paid: 0 },
    { id: 'demo-8', name: 'Cameron Vale', total: 2, used: 1, price: 100, paid: 100 },
    { id: 'demo-9', name: 'Quinn Harper', total: 4, used: 0, price: 200, paid: 50 },
  ];
  return { clients, appointments: clients.map((c, i) => ({ id: `demo-appt-${i}`, clientId: c.id, trainer: demoTrainers[i % 3] ?? 'Avery', date: DEMO_DATE, start: 420 + Math.floor(i / 3) * 90 + (i % 3) * 30, duration: 30, status: 'booked' })) };
}
export function demoTime(minute: number) { const h = Math.floor(minute / 60); return `${h % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
export function demoVisit(state: DemoState, appointment: DemoAppointment) {
  if (appointment.completedVisit !== undefined) return appointment.completedVisit;
  const client = state.clients.find(c => c.id === appointment.clientId);
  const booked = state.appointments.filter(a => a.clientId === appointment.clientId && a.status === 'booked').sort((a,b) => a.date.localeCompare(b.date) || a.start-b.start || a.id.localeCompare(b.id));
  return (client?.used ?? 0) + booked.findIndex(a => a.id === appointment.id) + 1;
}
export function demoSlotFree(state: DemoState, slot: Pick<DemoAppointment, 'trainer' | 'date' | 'start' | 'duration'>, exclude: string[] = [], clientId?: string) {
  return slot.start >= 360 && slot.start + slot.duration <= 1140 && slot.duration > 0 && !state.appointments.some(a => !exclude.includes(a.id) && a.status !== 'cancelled' && a.date === slot.date && (a.trainer === slot.trainer || (clientId !== undefined && a.clientId === clientId)) && slot.start < a.start+a.duration && a.start < slot.start+slot.duration);
}
export function demoOpenings(state: DemoState, date: string, trainers: readonly DemoTrainer[], duration: number) {
  return Array.from({length: 26}, (_, i) => 360+i*30).flatMap(start => trainers.filter(trainer => demoSlotFree(state, {date, trainer, start, duration})).map(trainer => ({date, trainer, start, duration})));
}
export function demoBook(state: DemoState, appointment: DemoAppointment, packageChange?: {total: number; price: number}): DemoState {
  const client = state.clients.find(c => c.id === appointment.clientId);
  if (!client || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || state.appointments.some(a => a.id === appointment.id)) throw new Error('Select a demo client and a valid date.');
  if (!demoSlotFree(state, appointment, [], client.id)) throw new Error('This trainer or client already has an appointment at that time.');
  const reservations = state.appointments.filter(a => a.clientId === client.id && a.status === 'booked').length;
  if (packageChange && (client.used > 0 || reservations > 0)) throw new Error('Use the existing package while it has visits or reservations.');
  const total = packageChange?.total ?? client.total;
  if (!Number.isInteger(total) || total < 1 || total > 100 || (packageChange && (!Number.isFinite(packageChange.price) || packageChange.price < 0))) throw new Error('Enter 1–100 visits and a nonnegative demo price.');
  if (client.used + reservations >= total) throw new Error('No unreserved visits remain in this demo package.');
  return { clients: state.clients.map(c => c.id === client.id && packageChange ? {...c, total, price: packageChange.price, paid: 0} : c), appointments: [...state.appointments, appointment] };
}
export function demoMove(state: DemoState, id: string, slot: Pick<DemoAppointment, 'trainer' | 'date' | 'start' | 'duration'>): DemoState {
  const a = state.appointments.find(a => a.id === id);
  if (!a || a.status !== 'booked') throw new Error('Only booked demo appointments can move.');
  if (!demoSlotFree(state, slot, [id], a.clientId)) throw new Error('This trainer or client is unavailable at that time.');
  return {...state, appointments: state.appointments.map(a => a.id === id ? {...a, ...slot} : a)};
}
export function demoSwap(state: DemoState, first: string, second: string): DemoState {
  const a = state.appointments.find(a => a.id === first), b = state.appointments.find(a => a.id === second);
  if (!a || !b || a.id === b.id || a.status !== 'booked' || b.status !== 'booked') throw new Error('Choose two different booked appointments.');
  const slotA = {date: b.date, start: b.start, trainer: b.trainer, duration: a.duration};
  const slotB = {date: a.date, start: a.start, trainer: a.trainer, duration: b.duration};
  if (!demoSlotFree(state, slotA, [a.id,b.id], a.clientId) || !demoSlotFree(state, slotB, [a.id,b.id], b.clientId)) throw new Error('The swapped appointments would overlap another appointment.');
  return {...state, appointments: state.appointments.map(x => x.id === a.id ? {...x,...slotA} : x.id === b.id ? {...x,...slotB} : x)};
}
export function demoComplete(state: DemoState, id: string): DemoState {
  const a = state.appointments.find(a => a.id === id);
  if (!a || a.status !== 'booked') return state;
  const client = state.clients.find(c => c.id === a.clientId);
  if (!client || demoVisit(state,a) !== client.used+1) throw new Error('Complete earlier visits for this demo client first.');
  return {clients: state.clients.map(c => c.id === a.clientId ? {...c, used:c.used+1} : c), appointments: state.appointments.map(x => x.id === id ? {...x,status:'completed', completedVisit: client.used+1} : x)};
}
export function demoCancel(state: DemoState, id: string): DemoState {
  return {...state, appointments: state.appointments.map(a => a.id === id && a.status === 'booked' ? {...a,status:'cancelled'} : a)};
}