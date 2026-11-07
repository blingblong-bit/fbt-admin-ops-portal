import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSchedulingFollowups, getSchedulingSettings, saveSchedulingFollowup } from '@/lib/scheduling-push.functions';
import { chicagoDueToIso } from '@/components/SchedulingFollowupDialog';

export const Route = createFileRoute('/_authenticated/follow-ups')({
  validateSearch: (s: Record<string, unknown>) => ({ task: typeof s.task === 'string' && /^[0-9a-f-]{36}$/.test(s.task) ? s.task : undefined }),
  head: () => ({ meta: [{ title: 'Scheduling Follow-ups — FIT Beyond Therapy Hub' }, { name: 'description', content: 'Assigned scheduling follow-ups and recorded outcomes.' }, { property: 'og:title', content: 'Scheduling Follow-ups — FIT Beyond Therapy Hub' }, { property: 'og:description', content: 'Assigned scheduling follow-ups and recorded outcomes.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] }),
  component: FollowupsPage,
});

function FollowupsPage() {
  const fetchTasks = useServerFn(getSchedulingFollowups);
  const fetchSettings = useServerFn(getSchedulingSettings);
  const tasks = useQuery({ queryKey: ['scheduling-followups'], queryFn: () => fetchTasks(), refetchOnWindowFocus: true });
  const settings = useQuery({ queryKey: ['scheduling-settings'], queryFn: () => fetchSettings() });
  const [completed, setCompleted] = useState(false);
  const { task: selected } = Route.useSearch();
  const rows = (tasks.data ?? []).filter(t => selected ? t.id === selected : (t.status === 'completed') === completed);
  return <AppShell><div className="mx-auto max-w-4xl space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Scheduling Follow-ups</h1><div className="flex gap-2"><Button asChild variant="outline"><Link to="/schedule-check">Schedule Check</Link></Button><Button asChild variant="outline"><Link to="/notifications">Notifications</Link></Button></div></header>
    {!selected && <div className="flex gap-2"><Button variant={!completed ? 'default' : 'outline'} onClick={() => setCompleted(false)}>Open</Button><Button variant={completed ? 'default' : 'outline'} onClick={() => setCompleted(true)}>Completed</Button></div>}
    {selected && <Button asChild variant="outline"><Link to="/follow-ups" search={{ task: undefined }}>All follow-ups</Link></Button>}
    {tasks.isPending && <p role="status">Loading follow-ups…</p>}{(tasks.isError || settings.isError) && <p role="alert" className="text-destructive">Could not load scheduling follow-ups. Refresh to try again.</p>}
    {tasks.isSuccess && rows.length === 0 && <p className="py-8 text-muted-foreground">{selected ? 'This follow-up is unavailable.' : completed ? 'No completed follow-ups.' : 'No open follow-ups.'}</p>}
    <ul className="divide-y">{rows.map(t => <TaskRow key={t.id} task={t} settings={settings.data} />)}</ul>
  </div></AppShell>;
}

function TaskRow({ task, settings }: { task: Awaited<ReturnType<typeof getSchedulingFollowups>>[number]; settings: Awaited<ReturnType<typeof getSchedulingSettings>> | undefined }) {
  const save = useServerFn(saveSchedulingFollowup); const qc = useQueryClient();
  const [outcome, setOutcome] = useState(''); const [owner, setOwner] = useState(task.owner_id);
  const [day, setDay] = useState(''); const [time, setTime] = useState(''); const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false);
  const canEdit = settings && (settings.isAdmin || task.owner_id === settings.userId || task.created_by === settings.userId);
  async function submit(done: boolean) { setBusy(true); try {
    await save({ data: { id: task.id, clientId: null, ownerId: done ? null : owner, due: done ? null : chicagoDueToIso(day, time), context: null, outcome: done ? outcome : null } });
    await qc.invalidateQueries({ queryKey: ['scheduling-followups'] }); setEditing(false); toast.success(done ? 'Outcome recorded; follow-up completed' : 'Assignment updated');
  } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save follow-up'); } finally { setBusy(false); } }
  return <li className="space-y-3 py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{task.clients?.first_name} {task.clients?.last_name}</h2><p className="text-sm text-muted-foreground">Due {new Date(task.due_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Chicago · {task.status}</p><p className="text-sm text-muted-foreground">Assigned: {settings?.staffAccounts.find(a => a.id === task.owner_id)?.label ?? 'Staff account'}</p></div><Button asChild variant="outline" size="sm"><Link to="/clients/$id" params={{ id: task.client_id }}>Client</Link></Button></div><p className="break-words text-sm">{task.context}</p>
    {task.status === 'completed' && <p className="text-sm">Outcome: {task.outcome}</p>}
    {task.status === 'open' && canEdit && <><div className="space-y-2"><Label htmlFor={`outcome-${task.id}`}>Outcome</Label><Input id={`outcome-${task.id}`} value={outcome} maxLength={1000} placeholder="Record what happened" onChange={e => setOutcome(e.target.value)} /></div><div className="flex flex-wrap gap-2"><Button disabled={busy || !outcome.trim()} onClick={() => submit(true)}>Complete follow-up</Button><Button variant="outline" onClick={() => setEditing(!editing)}>Reassign / change due time</Button></div>
    {editing && <div className="space-y-3 border-l-2 border-primary pl-4"><Select value={owner} onValueChange={setOwner}><SelectTrigger aria-label="Assigned staff member"><SelectValue /></SelectTrigger><SelectContent>{settings.staffAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent></Select><div className="grid grid-cols-2 gap-3"><Input aria-label="New due date Chicago" type="date" value={day} onChange={e => setDay(e.target.value)} /><Input aria-label="New due time Chicago" type="time" value={time} onChange={e => setTime(e.target.value)} /></div><Button disabled={busy || !day || !time || !owner} onClick={() => submit(false)}>Save assignment</Button></div>}</>}
  </li>;
}