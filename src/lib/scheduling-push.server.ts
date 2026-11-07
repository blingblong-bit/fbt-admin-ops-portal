import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { authorizeCron } from './activation-tick.server';
import { canNotifyTask, GENERIC_PUSH, PUSH_ORIGIN, subscriptionSchema } from './scheduling-push';

type DB = SupabaseClient<Database>;
const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function encryptionKey(secret: string | undefined) {
  if (!secret || secret.length < 64) throw new Error('Push key storage is not configured');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function provisionPushKeys(db: DB, secret: string | undefined) {
  const { data, error } = await db.from('scheduling_push_secrets').select('public_key').eq('id', true).maybeSingle();
  if (error) throw new Error('Could not read push configuration');
  if (data) return data.public_key;
  const key = await encryptionKey(secret);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('Could not generate push keys');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(jwk.d));
  const publicKey = encode(new Uint8Array(raw));
  // Concurrent provisioning cannot replace a key already used by devices.
  const result = await db.from('scheduling_push_secrets').upsert({ id: true, public_key: publicKey,
    encrypted_private_key: `${encode(iv)}.${encode(new Uint8Array(encrypted))}` }, { onConflict: 'id', ignoreDuplicates: true });
  if (result.error) throw new Error('Could not store push keys');
  const saved = await db.from('scheduling_push_secrets').select('public_key').eq('id', true).single();
  if (!saved.data || saved.error) throw new Error('Could not read push public key');
  return saved.data.public_key;
}

async function sendDevice(db: DB, attemptId: string, device: Database['public']['Tables']['scheduling_push_devices']['Row'], taskId: string | null, secret: string | undefined) {
  try {
    const subscription = subscriptionSchema.parse({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth_key } });
    const { data, error } = await db.from('scheduling_push_secrets').select('*').eq('id', true).single();
    if (!data || error) throw new Error('key-unavailable');
    const [iv, encrypted] = data.encrypted_private_key.split('.');
    if (!iv || !encrypted) throw new Error('key-unavailable');
    const key = await encryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(encrypted));
    const payload = await buildPushPayload({ data: { title: 'FIT Beyond Therapy Hub', body: taskId ? GENERIC_PUSH : 'Your Hub notification test',
      url: taskId ? `/follow-ups?task=${taskId}` : '/notifications', tag: taskId ?? attemptId }, options: { ttl: 300, urgency: 'normal' } },
      { ...subscription, expirationTime: null }, { publicKey: data.public_key, privateKey: new TextDecoder().decode(decrypted), subject: PUSH_ORIGIN });
    const response = await fetch(device.endpoint, { ...payload, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const expired = response.status === 404 || response.status === 410;
    const status = response.ok ? 'accepted' : expired ? 'expired' : 'failed';
    const errorCode = response.ok ? null : `push-service-${response.status}`;
    const recorded = await db.from('scheduling_push_attempts').update({ status, error_code: errorCode, finished_at: new Date().toISOString() }).eq('id', attemptId);
    if (recorded.error) return 'unknown'; // Accepted but recording failed: never claim delivered.
    if (expired) await db.from('scheduling_push_devices').update({ enabled: false, last_error: errorCode }).eq('id', device.id);
    return status;
  } catch {
    await db.from('scheduling_push_attempts').update({ status: 'failed', error_code: 'push-send-failed', finished_at: new Date().toISOString() }).eq('id', attemptId);
    return 'failed'; // Never persist provider bodies, endpoints, tokens or key-derived diagnostics.
  }
}

export async function selfTestPush(db: DB, userId: string, deviceId: string, secret: string | undefined) {
  const { data: device } = await db.from('scheduling_push_devices').select('*').eq('id', deviceId).eq('user_id', userId).eq('enabled', true).single();
  if (!device) throw new Error('This device is not registered to your account');
  const { data, error } = await db.rpc('claim_scheduling_push_test', { p_user: userId, p_device: device.id });
  if (!data || error) throw new Error('Could not record notification attempt');
  return sendDevice(db, data, device, null, secret);
}

export async function runSchedulingPush(db: DB, secret: string | undefined, origin = PUSH_ORIGIN) {
  const runToken = crypto.randomUUID();
  const lease = await db.rpc('acquire_scheduling_push_run', { p_token: runToken });
  if (lease.error) throw new Error('Could not acquire scheduling reminder run');
  if (!lease.data) return { claimed: 0, accepted: 0, failed: 0, expired: 0, suppressed: 0, unknown: 0 };
  try {
  const claimed = await db.rpc('claim_scheduling_push', { p_origin: origin });
  if (claimed.error) throw new Error('Could not claim scheduling reminders');
  const counts = { claimed: claimed.data.length, accepted: 0, failed: 0, expired: 0, suppressed: 0, unknown: 0 };
  for (const attempt of claimed.data) {
    if (!attempt.task_id || !attempt.device_id || attempt.revision === null) continue;
    // Re-read state after atomic claim: completed/reassigned/disabled/stale tasks cannot send.
    const [{ data: task }, { data: device }, { data: config }] = await Promise.all([
      db.from('scheduling_followups').select('*').eq('id', attempt.task_id).single(),
      db.from('scheduling_push_devices').select('*').eq('id', attempt.device_id).single(),
      db.from('scheduling_push_config').select('*').eq('id', true).single(),
    ]);
    const role = config?.scheduler_id ? await db.rpc('has_role', { _user_id: config.scheduler_id, _role: 'staff' }) : null;
    const admin = config?.scheduler_id ? await db.rpc('is_admin', { _user_id: config.scheduler_id }) : null;
    const client = task ? await db.from('clients').select('deleted_at').eq('id', task.client_id).single() : null;
    if (!task || !device || !config || !role?.data || admin?.data !== false || !client?.data || client.data.deleted_at ||
      device.origin !== origin || attempt.recipient_id !== task.owner_id || !canNotifyTask(task, config, device, new Date(), attempt.revision)) {
      await db.from('scheduling_push_attempts').update({ status: 'suppressed', finished_at: new Date().toISOString() }).eq('id', attempt.id);
      counts.suppressed++; continue;
    }
    const status = await sendDevice(db, attempt.id, device, task.id, secret);
    counts[status]++;
  }
  return counts;
  } finally {
    await db.rpc('release_scheduling_push_run', { p_token: runToken });
  }
}

export async function handleSchedulingPushTick(request: Request, deps: { cronSecret: string | undefined; run: () => Promise<unknown> }) {
  if (!authorizeCron(request, deps.cronSecret)) return new Response('forbidden', { status: 403 });
  try { return Response.json(await deps.run()); }
  catch { return Response.json({ error: 'Scheduling reminder check failed' }, { status: 500 }); }
}