import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Button } from '@/components/ui/button';
import { getScheduleCheck } from '@/lib/schedule.functions';
import { chicagoYmd } from '@/lib/work-week';
export function DashboardTodaySchedule() {
  const date = chicagoYmd(); const fn = useServerFn(getScheduleCheck);
  const q = useQuery({ queryKey: ['schedule-check',date], queryFn:()=>fn({data:{date}}), staleTime:60_000 });
  return <section className="border-y py-4"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><h2 className="text-lg font-semibold">Today’s schedule <span className="text-sm font-normal text-muted-foreground">({q.data?.selected_day.length??'—'})</span></h2><Button asChild variant="link" className="px-0"><Link to="/schedule-check">Appointments →</Link></Button></div>{q.isPending?<p role="status" className="text-sm text-muted-foreground">Loading appointments…</p>:q.isError||q.data?.error?<p role="alert" className="text-sm text-destructive">Today’s schedule could not load. <Button variant="outline" onClick={()=>q.refetch()}>Retry</Button></p>:q.data?.selected_day.length?<ul className="mt-2 divide-y">{q.data.selected_day.slice(0,4).map(a=><li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">{a.client?<Link to="/clients/$id" params={{id:a.client.id}} className="min-w-0 truncate font-medium">{a.client.first_name} {a.client.last_name}</Link>:<span className="min-w-0 truncate">{a.customer_name??'Unmatched appointment'}</span>}<span className="shrink-0 text-muted-foreground">{new Date(a.start_at).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}</span></li>)}</ul>:<p className="text-sm text-muted-foreground">No appointments today.</p>}</section>;
}
