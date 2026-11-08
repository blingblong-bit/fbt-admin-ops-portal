import { chicagoYmd, workWeekStartFromYmd } from './work-week';

export type QueueTask = { id: string; client_id: string; owner_id: string; due_at: string; status: string; context: string; created_at: string; outcome?: string | null };
export type WeekOutcome = { client_id: string | null; activity_type: string; created_at: string; description: string; metadata?: unknown };

export function activityWeek(activity: {created_at:string;metadata?:unknown}) {
  const m = activity.metadata;
  const week = m && typeof m === 'object' && 'week_start' in m ? m.week_start : null;
  return typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : workWeekStartFromYmd(chicagoYmd(new Date(activity.created_at)));
}

export function contactAttribution(activity: WeekOutcome | undefined) {
  const metadata = activity?.metadata;
  const name = metadata && typeof metadata === 'object' && 'actor_name' in metadata ? metadata.actor_name : null;
  return typeof name === 'string' && name.trim() && !name.includes('@') ? name.trim().slice(0,80) : 'Staff';
}

/** Presentation only: booking criteria are provided by the existing Schedule Check. */
export function outreachState(clientId: string, week: string, tasks: QueueTask[], activities: WeekOutcome[], now: string) {
  const inWeek = (iso: string) => workWeekStartFromYmd(chicagoYmd(new Date(iso))) === week;
  const unavailable = activities.filter(a => a.client_id === clientId && a.activity_type === 'unavailable_next_week' && activityWeek(a) === week).sort((a,b) => b.created_at.localeCompare(a.created_at))[0];
  const linked = tasks.filter(t => t.client_id === clientId && (t.context.includes(`[rebooking:${week}]`) || (t.context.startsWith('This Week') && !t.context.includes('[rebooking:') && inWeek(t.created_at))));
  const task = linked.filter(t => t.status === 'open' && !!t.owner_id && Number.isFinite(Date.parse(t.due_at))).sort((a,b) => a.due_at.localeCompare(b.due_at))[0];
  const contact = activities.filter(a => a.client_id === clientId && a.activity_type === 'contacted' && activityWeek(a) === week).sort((a,b) => b.created_at.localeCompare(a.created_at))[0];
  const contacted = !!contact;
  if (unavailable) return { group: 'closed' as const, task: undefined, due: false, reason: unavailable.description, contacted, contact };
  if (contacted || task) return { group: 'waiting' as const, task, due: !!task && task.due_at <= now, reason: null, contacted, contact };
  return { group: 'outreach' as const, task: undefined, due: false, reason: null, contacted, contact };
}

/** Main action categories are disjoint without changing source memberships. */
export function primaryQueueIds(rebooking: string[], completed: string[], lastWeek: string[], notScheduled: string[], onlyOnce: string[], hidden: string[]) {
  const seen = new Set<string>();
  const take = (ids: string[]) => ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });
  return { rebooking: take(rebooking), completed: take(completed), lastWeek: take(lastWeek), notScheduled: take(notScheduled), onlyOnce: take(onlyOnce), hidden: take(hidden) };
}