import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Bell, RefreshCw, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSchedulingSettings, removeSchedulingDevice, registerSchedulingDevice, setupSchedulingPushKeys, saveSchedulingPushConfig, testSchedulingPush } from '@/lib/scheduling-push.functions';
import { currentPushSubscription, enablePushDevice, readPushCapability } from '@/lib/scheduling-push.browser';
import { PUSH_ORIGIN } from '@/lib/scheduling-push';

export const Route = createFileRoute('/_authenticated/notifications')({
  head: () => ({ meta: [ { title: 'Notifications — FIT Beyond Therapy Hub' }, { name: 'description', content: 'Staff device notifications and scheduler reminder settings.' }, { property: 'og:title', content: 'Notifications — FIT Beyond Therapy Hub' }, { property: 'og:description', content: 'Staff device notifications and scheduler reminder settings.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' } ] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const fetchSettings = useServerFn(getSchedulingSettings);
  const register = useServerFn(registerSchedulingDevice);
  const remove = useServerFn(removeSchedulingDevice);
  const setupKeys = useServerFn(setupSchedulingPushKeys);
  const saveConfig = useServerFn(saveSchedulingPushConfig);
  const testPush = useServerFn(testSchedulingPush);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['scheduling-settings'], queryFn: () => fetchSettings() });
  const [cap, setCap] = useState<ReturnType<typeof readPushCapability> | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [localSubscribed, setLocalSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('My iPhone');
  const [scheduler, setScheduler] = useState('none');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [enabled, setEnabled] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['scheduling-settings'] });
  useEffect(() => {
    setCap(readPushCapability());
    currentPushSubscription().then(s => setLocalSubscribed(!!s)).catch(() => setLocalSubscribed(false));
    // Account-scoped local device ID contains no endpoint or credentials.
    setDeviceId(settings.data ? localStorage.getItem(`fit-push-device:${settings.data.userId}`) : null);
  }, [settings.data]);
  useEffect(() => { if (settings.data) { setScheduler(settings.data.config?.scheduler_id ?? 'none'); setStart(settings.data.config?.reminder_start?.slice(0, 5) ?? ''); setEnd(settings.data.config?.reminder_end?.slice(0, 5) ?? ''); setEnabled(settings.data.config?.enabled ?? false); } }, [settings.data]);
  const current = settings.data?.devices.find(d => d.id === deviceId);
  async function act(fn: () => Promise<unknown>) { setBusy(true); try { await fn(); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Notification action failed'); } finally { setBusy(false); setCap(readPushCapability()); } }
  return <AppShell><div className="mx-auto max-w-3xl space-y-8">
    <header className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Notifications</h1><p className="mt-1 text-sm text-muted-foreground">Scheduling follow-ups · Philip/Dad escalation off</p></div><Button variant="outline" size="icon" aria-label="Refresh notification settings" onClick={() => refresh()}><RefreshCw className="size-4" /></Button></header>
    {settings.isPending && <p role="status">Loading notification settings…</p>}
    {settings.isError && <p role="alert" className="text-destructive">{settings.error.message}</p>}
    {settings.data && <>
      <section className="space-y-4 border-b pb-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Smartphone className="size-5" />This device</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-muted-foreground">Home Screen</dt><dd>{cap?.installed ? 'Installed' : 'Not installed'}</dd><dt className="text-muted-foreground">Browser permission</dt><dd>{cap?.permission ?? 'Checking…'}</dd><dt className="text-muted-foreground">Device subscription</dt><dd>{current?.enabled && localSubscribed ? 'Enabled for your account' : localSubscribed ? 'Browser subscribed; account registration missing or disabled' : 'Not enabled'}</dd><dt className="text-muted-foreground">Notification keys</dt><dd>{settings.data.publicKey ? 'Ready' : 'Admin setup needed'}</dd></dl>
        {!cap?.publishedOrigin && <p className="border-l-2 border-primary pl-3 text-sm">Device push is available only in the published Hub, not this review preview. Nothing is subscribed here.</p>}
        {!cap?.installed && <div className="space-y-2 text-sm"><h3 className="font-medium">Install on iPhone · iOS 16.4 or later</h3><ol className="list-decimal space-y-1 pl-5"><li>Open <a className="underline" href={PUSH_ORIGIN} target="_blank" rel="noreferrer">FIT Beyond Therapy Hub</a> in Safari.</li><li>Tap Share, then Add to Home Screen.</li><li>Open FIT Hub from that icon, sign in and return to Notifications.</li><li>Tap Enable this device, then Allow. Adding the icon alone does not enable alerts.</li></ol></div>}
        {cap?.state === 'unsupported' && <p role="status" className="text-muted-foreground">This browser does not support web push here. Use an updated supported device/browser.</p>}
        {cap?.state === 'denied' && <p role="status" className="text-destructive">Permission is denied. Allow FIT Hub notifications in iPhone Settings before retrying.</p>}
        <div className="space-y-2"><Label htmlFor="device-label">Device name</Label><Input id="device-label" value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !settings.data.publicKey || cap?.state !== 'ready' || !cap.publishedOrigin || !label.trim()} onClick={() => {
          const key = settings.data?.publicKey; if (!key) return;
          // Start permission request on the tap, not after a server call.
          const subscriptionPromise = enablePushDevice(key);
          act(async () => { const sub = await subscriptionPromise; try {
            const result = await register({ data: { subscription: sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, origin: PUSH_ORIGIN, label } });
            if (settings.data) localStorage.setItem(`fit-push-device:${settings.data.userId}`, result.id);
            setDeviceId(result.id); setLocalSubscribed(true); toast.success('This device is enabled');
          } catch (e) { if (!current) await sub.unsubscribe(); throw e; } });
        }}><Bell className="size-4" />Enable this device</Button>
        <Button variant="outline" disabled={busy || !current?.enabled || !localSubscribed} onClick={() => act(async () => { if (!current) return; const result = await testPush({ data: { deviceId: current.id } }); toast.message(result.status === 'accepted' ? 'Push service accepted the test. Device receipt is not yet confirmed.' : `Test status: ${result.status}`); })}>Send test to this device</Button></div>
      </section>
      <section className="space-y-3 border-b pb-6"><h2 className="text-lg font-semibold">Your registered devices</h2>{settings.data.devices.length === 0 && <p className="text-sm text-muted-foreground">No registered devices.</p>}{settings.data.devices.map(d => <div key={d.id} className="flex items-center justify-between gap-3 border-b py-3"><div><p className="font-medium">{d.label}</p><p className="text-sm text-muted-foreground">{d.enabled ? 'Enabled' : 'Disabled / expired'}{d.last_error ? ` · ${d.last_error}` : ''}</p></div><Button variant="outline" disabled={busy} onClick={() => act(async () => { await remove({ data: { id: d.id } }); if (d.id === deviceId) { const s = await currentPushSubscription(); await s?.unsubscribe(); if (settings.data) localStorage.removeItem(`fit-push-device:${settings.data.userId}`); setDeviceId(null); setLocalSubscribed(false); } toast.success('Device removed'); })}>Disable</Button></div>)}</section>
      <section className="space-y-4 border-b pb-6"><h2 className="text-lg font-semibold">Scheduler setup</h2><p className="text-sm">{settings.data.config?.scheduler_id ? `Assigned: ${settings.data.staffAccounts.find(a => a.id === settings.data?.config?.scheduler_id)?.label ?? 'Selected staff account'}` : 'Setup needed: an admin must select the scheduling staff account.'}</p><p className="text-sm text-muted-foreground">Automatic alerts {settings.data.config?.enabled ? 'configured on' : 'off'} · Background job not scheduled · No owner/admin escalation</p>
        {settings.data.isAdmin && <><Button variant="outline" disabled={busy || !!settings.data.publicKey} onClick={() => act(async () => { await setupKeys(); toast.success('Notification keys securely prepared'); })}>Prepare notification keys</Button><div className="space-y-2"><Label>Scheduling staff account</Label><Select value={scheduler} onValueChange={setScheduler}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{settings.data.staffAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="reminder-start">Daily start · Chicago</Label><Input id="reminder-start" type="time" value={start} onChange={e => setStart(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="reminder-end">Daily end · Chicago</Label><Input id="reminder-end" type="time" value={end} onChange={e => setEnd(e.target.value)} /></div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable scheduler reminders after device consent</label><p className="text-xs text-muted-foreground">At most one reminder per open task/device each Chicago day, during the chosen window. The background job still requires publication and separate activation.</p><Button disabled={busy || (enabled && (!start || !end || scheduler === 'none'))} onClick={() => act(async () => { await saveConfig({ data: { scheduler: scheduler === 'none' ? null : scheduler, enabled, start: start || null, end: end || null } }); toast.success('Scheduler settings saved'); })}>Save scheduler settings</Button></>}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Notification attempts</h2><p className="text-xs text-muted-foreground">Latest 100 attempts. “Accepted” means accepted by the push service, not delivered or read. “Claimed” without a result is uncertain and is not retried that day.</p>{settings.data.attempts.length === 0 && <p className="text-sm text-muted-foreground">No notification attempts.</p>}<ul className="divide-y">{settings.data.attempts.map(a => <li key={a.id} className="py-3 text-sm">{new Date(a.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Chicago · {a.kind === 'test' ? 'Device test' : 'Scheduling follow-up'} · {a.status}{a.error_code ? ` · ${a.error_code}` : ''}</li>)}</ul></section>
    </>}
  </div></AppShell>;
}