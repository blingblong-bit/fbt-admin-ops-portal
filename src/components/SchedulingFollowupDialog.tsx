import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { markClientContacted } from '@/lib/schedule.functions';
import { getSchedulingSettings, saveSchedulingFollowup } from '@/lib/scheduling-push.functions';

// Explicit Chicago input: conversion checks DST gaps instead of silently changing time.
export function chicagoDueToIso(day: string, time: string) {
  const desired = `${day}T${time}`;
  const base = Date.parse(`${desired}:00Z`);
  if (!Number.isFinite(base)) throw new Error('Choose a date and time');
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const matches = [5, 6].map(h => new Date(base + h * 3600000)).filter(d => fmt.format(d).replace(' ', 'T') === desired);
  if (matches.length !== 1) throw new Error('That Chicago time is missing or repeated during daylight saving; choose another time');
  return matches[0].toISOString();
}

export function SchedulingFollowupDialog({ clientId, clientName, worklist, outreach = false }: { clientId: string; clientName: string; worklist: string; outreach?: boolean }) {
  const qc = useQueryClient();
  const markContacted = useServerFn(markClientContacted);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const fetchSettings = useServerFn(getSchedulingSettings);
  const save = useServerFn(saveSchedulingFollowup);
  const settings = useQuery({ queryKey: ['scheduling-settings'], queryFn: () => fetchSettings(), enabled: open });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" className="min-h-11 whitespace-normal"><CalendarPlus className="size-4" />{outreach ? "Record outreach / follow-up" : "Follow up"}</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Follow up · {clientName}</DialogTitle></DialogHeader>
      {settings.isError && <p role="alert" className="text-destructive">Could not load staff accounts. Try again.</p>}
      <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); try {
        await save({ data: { id: null, clientId, ownerId: owner, due: chicagoDueToIso(day, time), context: `${worklist}: ${context}`, outcome: null } });
        await qc.invalidateQueries({ queryKey: ['scheduling-followups'] });
        if (outreach) { try { await markContacted({ data: { clientId } }); await qc.invalidateQueries({ queryKey: ['rebooking-activities'] }); } catch { toast.error('Follow-up saved; contact marker could not be saved. The open follow-up remains available.'); } }
        toast.success('Scheduling follow-up created'); setOpen(false); setContext('');
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create follow-up'); } finally { setBusy(false); } }}>
        <div className="space-y-2"><Label>Assigned staff member</Label><Select value={owner} onValueChange={setOwner}><SelectTrigger><SelectValue placeholder="Select staff account" /></SelectTrigger><SelectContent>{settings.data?.staffAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent></Select></div>
        {!settings.isLoading && settings.data?.staffAccounts.length === 0 && <p className="text-muted-foreground text-sm">No eligible staff account is available.</p>}
        <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor={`due-day-${clientId}`}>Due date · Chicago</Label><Input id={`due-day-${clientId}`} type="date" required value={day} onChange={e => setDay(e.target.value)} /></div><div className="space-y-2"><Label htmlFor={`due-time-${clientId}`}>Due time · Chicago</Label><Input id={`due-time-${clientId}`} type="time" required value={time} onChange={e => setTime(e.target.value)} /></div></div>
        <div className="space-y-2"><Label htmlFor={`context-${clientId}`}>Follow-up details</Label><Input id={`context-${clientId}`} required maxLength={800} value={context} onChange={e => setContext(e.target.value)} /></div>
        <Button type="submit" disabled={busy || !owner || !day || !time || !context.trim()}>{busy ? 'Saving…' : 'Create follow-up'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}