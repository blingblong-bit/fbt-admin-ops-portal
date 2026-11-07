import { describe, expect, it, vi } from 'vitest';
import { canNotifyTask, deviceCapability, subscriptionSchema } from './scheduling-push';
import { handleSchedulingPushTick, provisionPushKeys, runSchedulingPush, selfTestPush } from './scheduling-push.server';
import { chicagoDueToIso } from '@/components/SchedulingFollowupDialog';

const scheduler = 'scheduler';
const now = new Date('2026-11-06T16:00:00Z'); // 10:00 Chicago
const task = { id: 'task', client_id: 'client', status: 'open', owner_id: scheduler, due_at: '2026-11-06T15:00:00Z', revision: 1 };
const cfg = { enabled: true, scheduler_id: scheduler, reminder_start: '09:00:00', reminder_end: '17:00:00' };
const device = { id: 'device', user_id: scheduler, enabled: true, origin: 'https://fbt-admin-ops-portal.lovable.app' };

describe('scheduler-only eligibility', () => {
  it('allows the configured scheduler and only that owner/device', () => {
    expect(canNotifyTask(task, cfg, device, now, 1)).toBe(true);
    expect(canNotifyTask({ ...task, owner_id: 'Dad' }, cfg, device, now, 1)).toBe(false);
    expect(canNotifyTask(task, cfg, { ...device, user_id: 'admin' }, now, 1)).toBe(false);
  });
  it('is off until scheduler selection and consent', () => {
    expect(canNotifyTask(task, { ...cfg, enabled: false }, device, now, 1)).toBe(false);
    expect(canNotifyTask(task, { ...cfg, scheduler_id: null }, device, now, 1)).toBe(false);
    expect(canNotifyTask(task, cfg, { ...device, enabled: false }, now, 1)).toBe(false);
  });
  it('suppresses completed, future, and stale/reassigned task revisions', () => {
    expect(canNotifyTask({ ...task, status: 'completed' }, cfg, device, now, 1)).toBe(false);
    expect(canNotifyTask({ ...task, due_at: '2026-11-07T16:00:00Z' }, cfg, device, now, 1)).toBe(false);
    expect(canNotifyTask(task, cfg, device, now, 2)).toBe(false);
  });
  it('uses Chicago quiet hours through DST and excludes the end boundary', () => {
    expect(canNotifyTask(task, cfg, device, new Date('2026-11-06T23:00:00Z'), 1)).toBe(false);
    expect(canNotifyTask({ ...task, due_at: '2026-10-31T00:00:00Z' }, cfg, device, new Date('2026-10-31T14:00:00Z'), 1)).toBe(true);
    expect(canNotifyTask(task, { ...cfg, reminder_start: null }, device, now, 1)).toBe(false);
  });
  it('does not assign arbitrary due times and rejects DST gaps/repeated times', () => {
    expect(chicagoDueToIso('2026-11-06', '10:00')).toBe('2026-11-06T16:00:00.000Z');
    expect(chicagoDueToIso('2026-07-06', '10:00')).toBe('2026-07-06T15:00:00.000Z');
    expect(() => chicagoDueToIso('2026-03-08', '02:30')).toThrow();
    expect(() => chicagoDueToIso('2026-11-01', '01:30')).toThrow();
  });
});

describe('push authorization and device validation', () => {
  it('rejects anonymous, public key and ordinary user before work; missing secret fails closed', async () => {
    const run = vi.fn(); const secret = 'a'.repeat(64);
    for (const token of [null, 'sb_publishable_public', 'ordinary-user-token']) {
      const response = await handleSchedulingPushTick(new Request('https://hub/api', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }), { cronSecret: secret, run });
      expect(response.status).toBe(403);
    }
    expect((await handleSchedulingPushTick(new Request('https://hub/api'), { cronSecret: undefined, run })).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it('permits only private cron bearer without returning it', async () => {
    const secret = 'a'.repeat(64); const run = vi.fn(async () => ({ claimed: 0 }));
    const r = await handleSchedulingPushTick(new Request('https://hub/api', { headers: { authorization: `Bearer ${secret}` } }), { cronSecret: secret, run });
    expect(r.status).toBe(200); expect(await r.text()).not.toContain(secret); expect(run).toHaveBeenCalledOnce();
  });
  it('rejects arbitrary endpoints and malformed subscription keys', () => {
    const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) };
    expect(subscriptionSchema.safeParse({ endpoint: 'https://web.push.apple.com/example', keys }).success).toBe(true);
    for (const endpoint of ['https://127.0.0.1/push', 'https://evil.example/push', 'http://web.push.apple.com/push', 'https://fcm.googleapis.com:444/push', 'https://x@web.push.apple.com/push']) {
      expect(subscriptionSchema.safeParse({ endpoint, keys }).success).toBe(false);
    }
    expect(subscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/push', keys: { ...keys, auth: 'bad' } }).success).toBe(false);
  });
  it('shows iPhone installation and denied/unsupported states honestly', () => {
    expect(deviceCapability({ secure: true, supported: true, ios: true, installed: false, permission: 'default' })).toBe('install-needed');
    expect(deviceCapability({ secure: true, supported: true, ios: true, installed: true, permission: 'denied' })).toBe('denied');
    expect(deviceCapability({ secure: true, supported: false, ios: true, installed: true, permission: 'default' })).toBe('unsupported');
  });
  it('self-test cannot target another user device', async () => {
    const filters: unknown[][] = [];
    const chain: any = { select: () => chain, eq: (...args: unknown[]) => { filters.push(args); return chain; }, single: async () => ({ data: null }) };
    const db: any = { from: vi.fn(() => chain) };
    await expect(selfTestPush(db, 'me', 'someone-elses-device', undefined)).rejects.toThrow('not registered to your account');
    expect(filters).toContainEqual(['user_id', 'me']); expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe('actual checker orchestration', () => {
  it('overlapping runs do not claim tasks', async () => {
    const db: any = { rpc: vi.fn(async () => ({ data: false, error: null })), from: vi.fn() };
    expect((await runSchedulingPush(db, undefined)).claimed).toBe(0);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('repeated/disabled empty claims do not send or load subscriptions', async () => {
    const db: any = { rpc: vi.fn(async (name: string) => ({ data: name === 'acquire_scheduling_push_run' ? true : [], error: null })), from: vi.fn() };
    expect((await runSchedulingPush(db, undefined)).claimed).toBe(0);
    expect((await runSchedulingPush(db, undefined)).claimed).toBe(0);
    expect(db.from).not.toHaveBeenCalled();
  });
  it('completion after claim suppresses send in real orchestration path', async () => {
    const updates: unknown[] = [];
    const db: any = {
      rpc: vi.fn(async (name: string) => ({ data: name === 'claim_scheduling_push' ? [{ id: 'attempt', task_id: 'task', device_id: 'device', recipient_id: scheduler, revision: 1 }] : ['has_role', 'acquire_scheduling_push_run'].includes(name) ? true : false, error: null })),
      from: (name: string) => {
        const chain: any = { select: () => chain, eq: () => chain,
          update: (v: unknown) => { updates.push(v); return chain; },
          single: async () => ({ data: name === 'scheduling_followups' ? { ...task, status: 'completed' } : name === 'scheduling_push_devices' ? device : name === 'clients' ? { deleted_at: null } : cfg }),
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) };
        return chain;
      },
    };
    const result = await runSchedulingPush(db, undefined);
    expect(result.suppressed).toBe(1); expect(result.accepted).toBe(0); expect(updates).toContainEqual(expect.objectContaining({ status: 'suppressed' }));
  });
  it('real encryption/send path marks expired subscription disabled and never delivered', async () => {
    let stored: any = null; const updates: { table: string; values: any }[] = [];
    const encode = (v: Uint8Array) => Buffer.from(v).toString('base64url');
    const clientPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = await crypto.subtle.exportKey('raw', clientPair.publicKey);
    const dev = { ...device, endpoint: 'https://web.push.apple.com/test', p256dh: encode(new Uint8Array(publicKey)), auth_key: encode(crypto.getRandomValues(new Uint8Array(16))) };
    const db: any = { rpc: vi.fn(async () => ({ data: 'attempt', error: null })), from: (table: string) => {
      const chain: any = { select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: stored, error: null }), single: async () => ({ data: table === 'scheduling_push_secrets' ? stored : dev, error: null }),
        upsert: (v: any) => { stored = v; return chain; },
        update: (v: any) => { updates.push({ table, values: v }); return chain; },
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) };
      return chain;
    } };
    await provisionPushKeys(db, 'test-only-encryption-secret'.repeat(4));
    const fetchMock = vi.fn(async () => new Response('', { status: 410 })); vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await selfTestPush(db, scheduler, 'device', 'test-only-encryption-secret'.repeat(4))).toBe('expired');
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(updates).toContainEqual({ table: 'scheduling_push_devices', values: { enabled: false, last_error: 'push-service-410' } });
      expect(updates).toContainEqual({ table: 'scheduling_push_attempts', values: expect.objectContaining({ status: 'expired' }) });
    } finally { vi.unstubAllGlobals(); }
  });
});