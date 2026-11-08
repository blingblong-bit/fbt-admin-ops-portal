import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScheduleWorklists } from '@/components/ScheduleWorklists';
import { RebookingQueue } from '@/components/RebookingQueue';
import { followUpEligible } from '@/lib/schedule-followup';
import { primaryQueueIds } from '@/lib/scheduling-queue-view';
import type { ScheduleCheckResult, WorklistRow } from '@/lib/schedule.functions';

export function SchedulingQueues({data}:{data:ScheduleCheckResult|undefined}) {
  const [all,setAll] = useState(false);
  if(!data) return <p role="status">Loading scheduling worklists…</p>;
  const next = new Set(data.next_week.flatMap(a=>a.client?[a.client.id]:[]));
  const hidden = new Set(data.worklists.hidden.map(r=>r.id));
  const rebooking = data.this_week.filter(a=>a.client && !next.has(a.client.id) && !hidden.has(a.client.id) && followUpEligible(a.client));
  const toRow = (c:ScheduleCheckResult['not_scheduled_after'][number]):WorklistRow => ({...c,reasons:[...(c.visit_count_check?[c.visit_count_check]:[]),'No Square appointment after selected date'],last_kept_visit:c.last_appointment_at,next_appointment_at:null});
  const noBooking = new Map(data.worklists.not_scheduled.map(c=>[c.id,c]));
  for(const c of [...data.last_week_nothing_booked,...data.not_scheduled_after]) if(!hidden.has(c.id) && !noBooking.has(c.id)) noBooking.set(c.id,toRow(c));
  const last = data.last_week_nothing_booked.filter(c=>!hidden.has(c.id)).map(c=>noBooking.get(c.id)??toRow(c));
  const ids = primaryQueueIds(rebooking.flatMap(a=>a.client?[a.client.id]:[]),data.worklists.package_completed.map(c=>c.id),last.map(c=>c.id),[...noBooking.keys()],data.worklists.only_once.map(c=>c.id),data.worklists.hidden.map(c=>c.id));
  const take = (rows:WorklistRow[], keys:string[])=>rows.filter(r=>keys.includes(r.id));
  const worklists = {...data.worklists,package_completed:all?data.worklists.package_completed:take(data.worklists.package_completed,ids.completed),not_scheduled:all?[...noBooking.values()]:take([...noBooking.values()],ids.notScheduled),only_once:all?data.worklists.only_once:take(data.worklists.only_once,ids.onlyOnce)};
  return <div className="space-y-4"><RebookingQueue appointments={rebooking} week={data.week_start} /><Button variant="outline" className="min-h-11 whitespace-normal" aria-pressed={all} onClick={()=>setAll(!all)}>{all?'Main worklist — one row per client':'All category memberships'}</Button><ScheduleWorklists data={worklists} filter="" lastWeek={all?last:take(last,ids.lastWeek)} /></div>;
}
