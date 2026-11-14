import { ScheduleWorklists } from '@/components/ScheduleWorklists';
import { RebookingQueue } from '@/components/RebookingQueue';
import { followUpEligible } from '@/lib/schedule-followup';
import type { ScheduleCheckResult, WorklistRow } from '@/lib/schedule.functions';

export function SchedulingQueues({data}:{data:ScheduleCheckResult|undefined}) {
  if(!data) return <p role="status">Loading scheduling worklists…</p>;
  const next = new Set(data.next_week.flatMap(a=>a.client?[a.client.id]:[]));
  const hidden = new Set(data.worklists.hidden.map(r=>r.id));
  const rebooking = data.this_week.filter(a=>a.client && !next.has(a.client.id) && !hidden.has(a.client.id) && followUpEligible(a.client));
  const toRow = (c:ScheduleCheckResult['not_scheduled_after'][number]):WorklistRow => ({...c,reasons:[...(c.visit_count_check?[c.visit_count_check]:[]),'No Square appointment after selected date'],last_kept_visit:c.last_appointment_at,next_appointment_at:null});
  const noBooking = new Map(data.worklists.not_scheduled.map(c=>[c.id,c]));
  for(const c of [...data.last_week_nothing_booked,...data.not_scheduled_after]) if(!hidden.has(c.id) && !noBooking.has(c.id)) noBooking.set(c.id,toRow(c));
  const last = data.last_week_nothing_booked.filter(c=>!hidden.has(c.id)).map(c=>noBooking.get(c.id)??toRow(c));
  const worklists = {...data.worklists,not_scheduled:[...noBooking.values()]};
  return <div className="space-y-4"><RebookingQueue appointments={rebooking} week={data.week_start} /><ScheduleWorklists data={worklists} filter="" lastWeek={last} /></div>;
}
