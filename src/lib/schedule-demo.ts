/** Browser-safe, disposable scheduling data. Never import production services here. */
export const DEMO_DATE = '2026-11-09';
export const DEMO_CAPACITY = 2;
export const demoTrainers = ['Avery', 'Jordan', 'Casey'] as const;
export type DemoTrainer = string;
export type DemoPackage = { id: string; total: number; used: number; price: number; paid: number };
export type DemoClient = { id: string; name: string; total: number; used: number; price: number; paid: number; packageId?: string; history?: DemoPackage[] };
export type DemoAppointment = { id: string; clientId: string; trainer: DemoTrainer; date: string; start: number; duration: number; status: 'booked' | 'completed' | 'cancelled'; completedVisit?: number; packageId?: string };
export type DemoState = { clients: DemoClient[]; appointments: DemoAppointment[]; trainers: string[] };
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
  ].map(c => ({...c, packageId: `${c.id}-package-1`, history: []}));
  return { clients, trainers: [...demoTrainers], appointments: clients.map((c, i) => ({ id: `demo-appt-${i}`, clientId: c.id, packageId: c.packageId, trainer: demoTrainers[i % 3] ?? 'Avery', date: DEMO_DATE, start: 420 + Math.floor(i / 3) * 90 + (i % 3) * 30, duration: 30, status: 'booked' })) };
}
export function demoTime(minute: number) { const h = Math.floor(minute / 60); return `${h % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
export function demoShiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function demoWeek(date: string) { const first = demoShiftDate(date, -new Date(`${date}T12:00:00Z`).getUTCDay()); return Array.from({length:7}, (_,i)=>demoShiftDate(first,i)); }
export function demoPackageFor(client: DemoClient, packageId?: string): DemoPackage {
  return client.history?.find(p=>p.id===packageId) ?? {id:client.packageId??`${client.id}-package-1`,total:client.total,used:client.used,price:client.price,paid:client.paid};
}
const samePackage = (a: DemoAppointment, id: string) => (a.packageId ?? `${a.clientId}-package-1`) === id;
export function demoUnreserved(state: DemoState, client: DemoClient) {
  const id = demoPackageFor(client).id;
  return client.total-client.used-state.appointments.filter(a=>a.clientId===client.id&&a.status==='booked'&&samePackage(a,id)).length;
}
export function demoVisit(state: DemoState, appointment: DemoAppointment) {
  if (appointment.completedVisit !== undefined) return appointment.completedVisit;
  if (appointment.status==='cancelled') return 0;
  const client = state.clients.find(c => c.id === appointment.clientId);
  if (!client) return 0;
  const pkg=demoPackageFor(client,appointment.packageId);
  const booked = state.appointments.filter(a => a.clientId === client.id && a.status === 'booked' && samePackage(a,pkg.id)).sort((a,b) => a.date.localeCompare(b.date) || a.start-b.start || a.id.localeCompare(b.id));
  return pkg.used + booked.findIndex(a => a.id === appointment.id) + 1;
}
export function demoSlotLoad(state: DemoState, slot: Pick<DemoAppointment, 'trainer' | 'date' | 'start' | 'duration'>, exclude: string[] = []) {
  const overlaps=state.appointments.filter(a=>!exclude.includes(a.id)&&a.status!=='cancelled'&&a.trainer===slot.trainer&&a.date===slot.date&&slot.start<a.start+a.duration&&a.start<slot.start+slot.duration);
  const points=[slot.start,...overlaps.map(a=>a.start).filter(start=>start>slot.start&&start<slot.start+slot.duration)];
  return Math.max(0,...points.map(start=>overlaps.filter(a=>a.start<=start&&start<a.start+a.duration).length));
}
export function demoSlotFree(state: DemoState, slot: Pick<DemoAppointment, 'trainer' | 'date' | 'start' | 'duration'>, exclude: string[] = [], clientId?: string) {
  return state.trainers.includes(slot.trainer) && Number.isInteger(slot.start) && Number.isInteger(slot.duration) && slot.start >= 360 && slot.start + slot.duration <= 1140 && slot.duration > 0 && demoSlotLoad(state,slot,exclude)<DEMO_CAPACITY && !state.appointments.some(a => !exclude.includes(a.id) && a.status !== 'cancelled' && a.date === slot.date && a.clientId===clientId && slot.start < a.start+a.duration && a.start < slot.start+slot.duration);
}
export function demoOpenings(state: DemoState, date: string, trainers: readonly DemoTrainer[], duration: number) {
  return Array.from({length: 26}, (_, i) => 360+i*30).flatMap(start => trainers.filter(trainer => demoSlotFree(state, {date, trainer, start, duration})).map(trainer => ({date, trainer, start, duration})));
}
export function demoBook(state: DemoState, appointment: DemoAppointment, packageChange?: {total: number; price: number}): DemoState {
  const client = state.clients.find(c => c.id === appointment.clientId);
  if (!client || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || Number.isNaN(Date.parse(appointment.date)) || state.appointments.some(a => a.id === appointment.id)) throw new Error('Select a demo client and a valid date.');
  if (!demoSlotFree(state, appointment, [], client.id)) throw new Error('Slot is full or this client already has an appointment at that time.');
  if (packageChange && demoUnreserved(state,client)>0) throw new Error('Use the existing package while unreserved visits remain.');
  if (packageChange && (!Number.isInteger(packageChange.total) || packageChange.total < 1 || packageChange.total > 100 || !Number.isFinite(packageChange.price) || packageChange.price < 0)) throw new Error('Enter 1–100 visits and a nonnegative demo price.');
  if (!packageChange && demoUnreserved(state,client)<=0) throw new Error('No unreserved visits remain in this demo package.');
  const packageId=packageChange ? `${client.id}-package-${appointment.id}` : demoPackageFor(client).id;
  return { ...state, clients: state.clients.map(c => c.id === client.id && packageChange ? {...c, history:[...(c.history??[]),demoPackageFor(c)], packageId, total:packageChange.total, used:0, price:packageChange.price, paid:0} : c), appointments: [...state.appointments, {...appointment,packageId}] };
}
export function demoMove(state: DemoState, id: string, slot: Pick<DemoAppointment, 'trainer' | 'date' | 'start' | 'duration'>): DemoState {
  const a = state.appointments.find(a => a.id === id);
  if (!a || a.status !== 'booked') throw new Error('Only booked demo appointments can move.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !demoSlotFree(state, slot, [id], a.clientId)) throw new Error('This slot is full or client is unavailable at that time.');
  return {...state, appointments: state.appointments.map(a => a.id === id ? {...a, ...slot} : a)};
}
export function demoSwap(state: DemoState, first: string, second: string): DemoState {
  const a = state.appointments.find(a => a.id === first), b = state.appointments.find(a => a.id === second);
  if (!a || !b || a.id === b.id || a.clientId===b.clientId || a.status !== 'booked' || b.status !== 'booked') throw new Error('Choose two different clients with booked appointments.');
  const slotA = {date: b.date, start: b.start, trainer: b.trainer, duration: a.duration};
  const slotB = {date: a.date, start: a.start, trainer: a.trainer, duration: b.duration};
  const next={...state,appointments:state.appointments.map(x=>x.id===a.id?{...x,...slotA}:x.id===b.id?{...x,...slotB}:x)};
  if (!demoSlotFree(next, slotA, [a.id], a.clientId) || !demoSlotFree(next, slotB, [b.id], b.clientId)) throw new Error('Swap conflict: slot capacity or another client appointment would overlap.');
  return next;
}
function consume(state: DemoState, a: DemoAppointment, status: 'completed'|'cancelled'): DemoState {
  const client=state.clients.find(c=>c.id===a.clientId);
  if (!client) throw new Error('Demo client missing.');
  const pkg=demoPackageFor(client,a.packageId);
  if(pkg.used>=pkg.total) throw new Error('No visits remain in this appointment’s package.');
  return {...state,clients:state.clients.map(c=>c.id!==client.id?c:pkg.id===demoPackageFor(c).id?{...c,used:c.used+1}:{...c,history:c.history?.map(p=>p.id===pkg.id?{...p,used:p.used+1}:p)}),appointments:state.appointments.map(x=>x.id===a.id?{...x,status,completedVisit:pkg.used+1}:x)};
}
export function demoComplete(state: DemoState, id: string): DemoState {
  const a = state.appointments.find(a => a.id === id);
  if (!a || a.status !== 'booked') return state;
  const client=state.clients.find(c=>c.id===a.clientId);
  if (!client || demoVisit(state,a)!==demoPackageFor(client,a.packageId).used+1) throw new Error('Complete earlier visits for this demo client first.');
  return consume(state,a,'completed');
}
export function demoCancel(state: DemoState, id: string, countVisit=false): DemoState {
  const a=state.appointments.find(a=>a.id===id);
  if(!a || a.status!=='booked') return state;
  if(countVisit) return consume(state,a,'cancelled');
  return {...state, appointments: state.appointments.map(x => x.id===id ? {...x,status:'cancelled'} : x)};
}
export function demoAddTrainer(state: DemoState, name: string, isAdmin: boolean): DemoState {
  if(!isAdmin) throw new Error('Only Hub admins can add demo trainers.');
  const clean=name.trim();
  if(!clean || clean.length>40 || state.trainers.some(t=>t.toLowerCase()===clean.toLowerCase())) throw new Error('Enter a unique trainer name, up to 40 characters.');
  return {...state,trainers:[...state.trainers,clean]};
}
