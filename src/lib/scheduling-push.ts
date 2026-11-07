import { z } from 'zod';

export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).url().refine((value) => {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.push.apple.com'));
  }, 'Unsupported push service'),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
});

export function chicagoMinute(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
}

export function canNotifyTask(task: { status: string; owner_id: string; due_at: string; revision: number },
  config: { enabled: boolean; scheduler_id: string | null; reminder_start: string | null; reminder_end: string | null },
  device: { enabled: boolean; user_id: string }, now: Date, claimedRevision: number) {
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return config.enabled && !!config.scheduler_id && task.owner_id === config.scheduler_id &&
    device.user_id === config.scheduler_id && device.enabled && task.status === 'open' &&
    task.revision === claimedRevision && new Date(task.due_at).getTime() <= now.getTime() &&
    !!config.reminder_start && !!config.reminder_end && chicagoMinute(now) >= minutes(config.reminder_start) &&
    chicagoMinute(now) < minutes(config.reminder_end);
}

export function deviceCapability(input: { secure: boolean; supported: boolean; ios: boolean; installed: boolean; permission: string }) {
  if (!input.secure || !input.supported) return 'unsupported';
  if (input.ios && !input.installed) return 'install-needed';
  if (input.permission === 'denied') return 'denied';
  return 'ready';
}

export const GENERIC_PUSH = 'A scheduling follow-up needs attention';
export const PUSH_ORIGIN = 'https://fbt-admin-ops-portal.lovable.app';