import type { ScheduleAppointment } from './schedule.functions';
import type { DemoBlocker } from './schedule-demo';

/** Display-only projection. Never copy live clients into the simulation engine. */
export function projectLiveAppointment(a: ScheduleAppointment) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(a.start_at));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const start = Number(get('hour')) * 60 + Number(get('minute'));
  const duration = a.duration_minutes;
  const trainer = a.team_member_name ?? (a.team_member_id ? `Unnamed trainer · ${a.team_member_id.slice(-4)}` : 'Trainer unavailable');
  const name = a.client ? `${a.client.first_name} ${a.client.last_name}`.trim() : [a.customer_info?.given_name, a.customer_info?.family_name].filter(Boolean).join(' ') || 'Unlinked Square client';
  const blocker: DemoBlocker = { id: a.booking_id, trainer, date, start: duration && duration > 0 ? start : 0, duration: duration && duration > 0 ? duration : 1440 };
  return { id: a.booking_id, name, trainer, date, start, duration, status: a.status, service: a.service_name, blocker, trainerUnknown: !a.team_member_name };
}