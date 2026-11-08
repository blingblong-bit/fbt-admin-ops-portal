import { useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Phone, MessageSquare, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SchedulingFollowupDialog } from '@/components/SchedulingFollowupDialog';
import { supabase } from '@/integrations/supabase/client';
import { getSchedulingFollowups } from '@/lib/scheduling-push.functions';
import { markClientUnavailableNextWeek, unmarkClientUnavailableNextWeek, unmarkClientContacted, markClientContacted, type ScheduleAppointment } from '@/lib/schedule.functions';
import { contactAttribution, outreachState, type WeekOutcome } from '@/lib/scheduling-queue-view';
import { formatDate } from '@/lib/clients';

export function RebookingQueue({ appointments, week }: { appointments: ScheduleAppointment[]; week: string }) {
  const busy = useRef(false);
  const [optimistic,setOptimistic] = useState<{id:string;contacted:boolean;closed:boolean}|null>(null);
  const [group,setGroup] = useState<'outreach'|'waiting'|'closed'>('outreach');
  const [reasonFor,setReasonFor] = useState<string|null>(null); const [reason,setReason] = useState('');
  const qc = useQueryClient(); const tasksFn = useServerFn(getSchedulingFollowups);
  const tasks = useQuery({queryKey:['scheduling-followups'],queryFn:() => tasksFn()});
  const perClient = useMemo(() => { const m = new Map<string,ScheduleAppointment>(); for (const a of appointments) if (a.client && !m.has(a.client.id)) m.set(a.client.id,a); return [...m.values()]; },[appointments]);
  const ids = perClient.flatMap(a => a.client ? [a.client.id] : []);
  const activities = useQuery({queryKey:['rebooking-activities',week,ids.slice().sort().join(',')],enabled:ids.length>0,queryFn:async () => {
    const r = await supabase.from('client_activities').select('client_id,activity_type,created_at,description,metadata').in('client_id',ids).in('activity_type',['contacted','unavailable_next_week']); if(r.error) throw r.error; return r.data;
  }});
  const refresh = () => { qc.invalidateQueries({queryKey: ["rebooking-activities"]});
    qc.invalidateQueries({queryKey: ["contacted-not-next-week"]});
    qc.invalidateQueries({queryKey: ["unavailable-next-week"]}); };
  const contactFn = useServerFn(markClientContacted);
  const unavailableFn = useServerFn(markClientUnavailableNextWeek); const undoUnavailableFn = useServerFn(unmarkClientUnavailableNextWeek); const undoContactFn = useServerFn(unmarkClientContacted);
  const action = useMutation({mutationFn:async ({id,kind}:{id:string;kind:'contact'|'undo'|'unavailable'|'reopen'}) => {
    if(kind==='contact') return contactFn({data:{clientId:id}});
    if(kind==='undo') return undoContactFn({data:{clientId:id}});
    if(kind==='unavailable') return unavailableFn({data:{clientId:id,reason}});
    return undoUnavailableFn({data:{clientId:id}});
  },onSuccess:async (_,vars)=>{
    refresh();
    await activities.refetch();
    setOptimistic(null);setReasonFor(null);setReason('');
    toast.success(vars.kind==='contact'?'Marked contacted — waiting on response':vars.kind==='unavailable'?'Unavailable this week':'Contact status reopened');
  },onError:(e:Error)=>{setOptimistic(null);toast.error(e.message);},onSettled:()=>{busy.current=false;}});
  const run = (id:string,kind:'contact'|'undo'|'unavailable'|'reopen') => {
    if(busy.current) return;
    busy.current=true;
    setOptimistic({id,contacted:kind==='contact',closed:kind==='unavailable'});
    action.mutate({id,kind});
  };
  const now = new Date().toISOString();
  const visibleActivities: WeekOutcome[] = (activities.data??[]).filter(a => !(optimistic?.id===a.client_id && ['contacted','unavailable_next_week'].includes(a.activity_type)));
  if(optimistic && (optimistic.contacted || optimistic.closed)) visibleActivities.push({client_id:optimistic.id,activity_type:optimistic.closed?'unavailable_next_week':'contacted',created_at:now,description:reason,metadata:{week_start:week}});
  const rows = perClient.flatMap(a => a.client ? [{a,c:a.client,state:outreachState(a.client.id,week,tasks.data??[],visibleActivities,now)}] : []).sort((a,b)=>Number(b.state.due)-Number(a.state.due)||(a.state.task?.due_at??a.a.start_at).localeCompare(b.state.task?.due_at??b.a.start_at));
  return <section className="border-b pb-6"><details open className="group"><summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"><div className="min-w-0"><h2 className="text-lg font-semibold">This Week but Not Next <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h2><p className="text-xs text-muted-foreground">Week of {formatDate(week)}</p></div><ChevronDown className="size-5 shrink-0 group-open:rotate-180" /></summary>
    <div className="mb-4 grid grid-cols-3 gap-1 rounded-md bg-muted p-1" role="group" aria-label="Outreach status">{(['outreach','waiting','closed'] as const).map(g => <Button key={g} variant={group===g?'default':'ghost'} className="h-auto min-h-12 whitespace-normal px-1 text-xs" aria-pressed={group===g} onClick={()=>setGroup(g)}>{g==='outreach'?'Needs Outreach':g==='waiting'?'Waiting on Response':'Unavailable'} ({rows.filter(r=>r.state.group===g).length})</Button>)}</div>
    {(tasks.isPending || (ids.length>0 && activities.isPending)) ? <p role="status">Loading outreach status…</p> : (tasks.isError || activities.isError) ? <p role="alert" className="text-destructive">Could not load outreach status. <Button variant="outline" onClick={()=>{tasks.refetch();activities.refetch();}}>Retry</Button></p> : <ul className="divide-y">{rows.filter(r=>r.state.group===group).map(({a,c,state}) => <li key={c.id} data-action-client={c.id} className="space-y-3 py-4"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><div className="min-w-0"><Link to="/clients/$id" params={{id:c.id}} className="font-semibold hover:underline">{c.first_name} {c.last_name}</Link><p className="text-xs text-muted-foreground">This week: {formatDate(a.start_at.slice(0,10))} · Nothing booked next week</p>{state.contact && <p className="text-sm text-muted-foreground">{contactAttribution(state.contact)==='Staff'?'Marked contacted':`Marked by ${contactAttribution(state.contact)}`} · {new Date(state.contact.created_at).toLocaleString('en-US',{timeZone:'America/Chicago'})} Chicago</p>}{state.task && <p className={`text-sm ${state.due?'font-semibold text-destructive':'text-muted-foreground'}`}>{state.due?'Due / overdue — action needed':'Awaiting reply'} · {new Date(state.task.due_at).toLocaleString('en-US',{timeZone:'America/Chicago'})} Chicago</p>}{state.reason && <p className="text-sm">{state.reason}</p>}</div></div>
      <div className="flex flex-wrap gap-2">{c.phone && <><Button asChild variant="outline" className="min-h-11"><a href={`tel:${c.phone.replace(/[^+\d]/g,'')}`}><Phone className="size-4" />Call</a></Button><Button asChild variant="outline" className="min-h-11"><a href={`sms:${c.phone.replace(/[^+\d]/g,'')}`}><MessageSquare className="size-4" />Text</a></Button></>}
      {group!=='closed' && !state.contacted && <Button className="min-h-11" disabled={action.isPending} onClick={()=>run(c.id,'contact')}><Check className="size-4" />Mark Contacted</Button>}
      {state.contacted && group!=='closed' && <Button variant="outline" className="min-h-11" disabled={action.isPending} onClick={()=>run(c.id,'undo')}>Undo contacted</Button>}
      {group!=='closed' && <Button variant="outline" className="min-h-11" disabled={action.isPending} onClick={()=>{setReasonFor(c.id);setReason('');}}>Mark Unavailable</Button>}
      {group==='closed' && <Button variant="outline" className="min-h-11" disabled={action.isPending} onClick={()=>run(c.id,'reopen')}>Reopen</Button>}</div>
      {group!=='closed' && <div>{state.task ? <Button asChild variant="ghost" className="min-h-11"><Link to="/follow-ups" search={{task:state.task.id}}>Open reminder</Link></Button> : <SchedulingFollowupDialog clientId={c.id} clientName={`${c.first_name} ${c.last_name}`} worklist={`This Week but Not Next [rebooking:${week}]`} triggerLabel="Add reminder" />}</div>}
      {reasonFor===c.id && <form className="space-y-2" onSubmit={e=>{e.preventDefault();run(c.id,'unavailable');}}><Input aria-label="Unavailable reason" placeholder="Reason (optional)" maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} /><div className="flex gap-2"><Button disabled={action.isPending}>Mark unavailable</Button><Button type="button" variant="ghost" onClick={()=>setReasonFor(null)}>Cancel</Button></div></form>}
    </li>)}</ul>}
    {!tasks.isPending && !activities.isPending && !tasks.isError && !activities.isError && rows.filter(r=>r.state.group===group).length===0 && <p className="py-5 text-sm text-muted-foreground">No clients in this status.</p>}
  </details></section>;
}
