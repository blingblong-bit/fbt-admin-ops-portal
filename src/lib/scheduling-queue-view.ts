import { chicagoYmd, workWeekStartFromYmd } from './work-week';

export type QueueTask = { id: string; client_id: string; owner_id: string; due_at: string; status: string; context: string; created_at: string; outcome?: string | null };
export type WeekOutcome = { client_id: string | null; activity_type: string; created_at: string; description: string };

/** Presentation only: booking criteria are provided by the existing Schedule Check. */
export function outreachState(clientId: string, week: string, tasks: QueueTask[], activities: WeekOutcome[], now: string) {
  const inWeek = (iso: string) => workWeekStartFromYmd(chicagoYmd(new Date(iso))) === week;
  const unavailable = activities.filter(a => a.client_id === clientId && a.activity_type === 'unavailable_next_week' && inWeek(a.created_at)).sort((a,b) => b.created_at.localeCompare(a.created_at))[0];
  const linked = tasks.filter(t => t.client_id === clientId && (t.context.includes(`[rebooking:${week}]`) || (t.context.startsWith('This Week') && !t.context.includes('[rebooking:') && inWeek(t.created_at))));
  const task = linked.filter(t => t.status === 'open' && !!t.owner_id && Number.isFinite(Date.parse(t.due_at))).sort((a,b) => a.due_at.localeCompare(b.due_at))[0];
  const contacted = activities.some(a => a.client_id === clientId && a.activity_type === 'contacted' && inWeek(a.created_at));
  if (unavailable) return { group: 'closed' as const, task: undefined, due: false, reason: unavailable.description, contacted };
  if (task) return { group: 'waiting' as const, task, due: task.due_at <= now, reason: null, contacted: true };
  return { group: 'outreach' as const, task: undefined, due: false, reason: null, contacted };
}

/** Main action categories are disjoint without changing source memberships. */
export function primaryQueueIds(rebooking: string[], completed: string[], lastWeek: string[], notScheduled: string[], onlyOnce: string[], hidden: string[]) {
  const seen = new Set<string>();
  const take = (ids: string[]) => ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });
  return { rebooking: take(rebooking), completed: take(completed), lastWeek: take(lastWeek), notScheduled: take(notScheduled), onlyOnce: take(onlyOnce), hidden: take(hidden) };
}