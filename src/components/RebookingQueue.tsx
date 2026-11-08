import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Phone, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SchedulingFollowupDialog } from '@/components/SchedulingFollowupDialog';
import { supabase } from '@/integrations/supabase/client';
import { getSchedulingFollowups } from '@/lib/scheduling-push.functions';
import { markClientUnavailableNextWeek, unmarkClientUnavailableNextWeek, unmarkClientContacted, type ScheduleAppointment } from '@/lib/schedule.functions';
import { outreachState } from '@/lib/scheduling-queue-view';
import { formatDate } from '@/lib/clients';

export function RebookingQueue({ appointments, week }: { appointments: ScheduleAppointment[]; week: string }) {
  const [group,setGroup] = useState<'outreach'|'waiting'|'closed'>('outreach');
  const [reasonFor,setReasonFor] = useState<string|null>(null); const [reason,setReason] = useState('');
  const qc = useQueryClient(); const tasksFn = useServerFn(getSchedulingFollowups);
  const tasks = useQuery({queryKey:['scheduling-followups'],queryFn:() => tasksFn()});
  const perClient = useMemo(() => { const m = new Map<string,ScheduleAppointment>(); for (const a of appointments) if (a.client && !m.has(a.client.id)) m.set(a.client.id,a); return [...m.values()]; },[appointments]);
  const ids = perClient.flatMap(a => a.client ? [a.client.id] : []);
  const activities = useQuery({queryKey:['rebooking-activities',week,ids.slice().sort().join(',')],enabled:ids.length>0,queryFn:async () => {
    const r = await supabase.from('client_activities').select('client_id,activity_type,created_at,description').in('client_id',ids).in('activity_type',['contacted','unavailable_next_week']); if(r.error) throw r.error; return r.data;
  }});
  const refresh = () => { qc.invalidateQueries({queryKey:['rebooking-activities']}); qc.invalidateQueries({queryKey:['contacted-not-next-week']}); qc.invalidateQueries({queryKey:['unavailable-next-week']}); };
  const unavailableFn = useServerFn(markClientUnavailableNextWeek); const undoUnavailableFn = useServerFn(unmarkClientUnavailableNextWeek); const undoContactFn = useServerFn(unmarkClientContacted);
  const unavailable = useMutation({mutationFn:(id:string) => unavailableFn({data:{clientId:id,reason}}),onSuccess:() => {refresh();setReasonFor(null);setReason('');toast.success('Unavailable outcome recorded for this week');},onError:(e:Error)=>toast.error(e.message)});
  const undo = useMutation({mutationFn:({id,closed}:{id:string;closed:boolean}) => closed ? undoUnavailableFn({data:{clientId:id}}) : undoContactFn({data:{clientId:id}}),onSuccess:()=>{refresh();toast.success('Reopened for outreach');},onError:(e:Error)=>toast.error(e.message)});
  const now = new Date().toISOString();
  const rows = perClient.flatMap(a => a.client ? [{a,c:a.client,state:outreachState(a.client.id,week,tasks.data??[],activities.data??[],now)}] : []).sort((a,b)=>Number(b.state.due)-Number(a.state.due)||(a.state.task?.due_at??a.a.start_at).localeCompare(b.state.task?.due_at??b.a.start_at));
  return <section className="border-b pb-6"><details open className="group"><summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"><div className="min-w-0"><h2 className="text-lg font-semibold">This Week but Not Next <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h2><p className="text-xs text-muted-foreground">Week of {formatDate(week)}</p></div><ChevronDown className="size-5 shrink-0 group-open:rotate-180" /></summary>
    <div className="mb-4 grid grid-cols-3 gap-1 rounded-md bg-muted p-1" role="group" aria-label="Outreach status">{(['outreach','waiting','closed'] as const).map(g => <Button key={g} variant={group===g?'default':'ghost'} className="h-auto min-h-12 whitespace-normal px-1 text-xs" aria-pressed={group===g} onClick={()=>setGroup(g)}>{g==='outreach'?'Needs Outreach':g==='waiting'?'Waiting on Response':'Unavailable'} ({rows.filter(r=>r.state.group===g).length})</Button>)}</div>
    {(tasks.isPending || (ids.length>0 && activities.isPending)) ? <p role="status">Loading outreach status…</p> : (tasks.isError || activities.isError) ? <p role="alert" className="text-destructive">Could not load outreach status. <Button variant="outline" onClick={()=>{tasks.refetch();activities.refetch();}}>Retry</Button></p> : <ul className="divide-y">{rows.filter(r=>r.state.group===group).map(({a,c,state}) => <li key={c.id} data-action-client={c.id} className="space-y-3 py-4"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><div className="min-w-0"><Link to="/clients/$id" params={{id:c.id}} className="font-semibold hover:underline">{c.first_name} {c.last_name}</Link><p className="text-xs text-muted-foreground">This week: {formatDate(a.start_at.slice(0,10))} · Nothing booked next week</p>{state.contacted && !state.task && group!=='closed' && <p className="text-sm text-muted-foreground">Contacted · follow-up owner and due date still needed</p>}{state.task && <p className={`text-sm ${state.due?'font-semibold text-destructive':'text-muted-foreground'}`}>{state.due?'Due / overdue — action needed':'Awaiting reply'} · {new Date(state.task.due_at).toLocaleString('en-US',{timeZone:'America/Chicago'})} Chicago</p>}{state.reason && <p className="text-sm">{state.reason}</p>}</div>{c.phone && <Button asChild size="icon" variant="outline" className="min-h-11 min-w-11"><a href={`tel:${c.phone.replace(/[^+\d]/g,'')}`} aria-label={`Call ${c.first_name}`} title="Call"><Phone /></a></Button>}</div>
      <div className="flex flex-wrap gap-2">{state.task ? <Button asChild variant="outline" className="min-h-11"><Link to="/follow-ups" search={{task:state.task.id}}>Open follow-up</Link></Button> : group!=='closed' && <SchedulingFollowupDialog clientId={c.id} clientName={`${c.first_name} ${c.last_name}`} worklist={`This Week but Not Next [rebooking:${week}]`} outreach />}{group!=='closed' && <Button variant="outline" className="min-h-11" onClick={()=>{setReasonFor(c.id);setReason('');}}>Unavailable this week</Button>}{(group==='closed' || (state.contacted && !state.task)) && <Button variant="ghost" className="min-h-11" disabled={undo.isPending} onClick={()=>{if(window.confirm('Reopen this client for outreach?')) undo.mutate({id:c.id,closed:group==='closed'});}}>Undo</Button>}</div>
      {reasonFor===c.id && <form className="space-y-2" onSubmit={e=>{e.preventDefault();unavailable.mutate(c.id);}}><Input aria-label="Unavailable reason" placeholder="Outcome / reason" required maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} /><div className="flex gap-2"><Button disabled={unavailable.isPending || !reason.trim()}>Record outcome</Button><Button type="button" variant="ghost" onClick={()=>setReasonFor(null)}>Cancel</Button></div></form>}
    </li>)}</ul>}
    {!tasks.isPending && !activities.isPending && !tasks.isError && !activities.isError && rows.filter(r=>r.state.group===group).length===0 && <p className="py-5 text-sm text-muted-foreground">No clients in this status.</p>}
  </details></section>;
}
