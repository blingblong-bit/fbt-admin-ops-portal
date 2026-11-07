import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { subscriptionSchema, PUSH_ORIGIN } from './scheduling-push';

export const getSchedulingSettings = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const staff = await context.supabase.rpc('is_staff', { _user_id: context.userId });
  if (staff.error || !staff.data) throw new Error('Staff access required');
  const admin = await context.supabase.rpc('is_admin', { _user_id: context.userId });
  const [config, devices, attempts] = await Promise.all([
    context.supabase.from('scheduling_push_config').select('*').maybeSingle(),
    context.supabase.from('scheduling_push_devices').select('id,label,enabled,origin,created_at,last_error').eq('user_id', context.userId),
    context.supabase.from('scheduling_push_attempts').select('id,task_id,kind,status,error_code,created_at,recipient_id').order('created_at', { ascending: false }).limit(100),
  ]);
  if (config.error || devices.error || attempts.error) throw new Error('Could not load notification settings');
  // Only after verified staff role; endpoint/key material never returned to UI.
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const key = await supabaseAdmin.from('scheduling_push_secrets').select('public_key').maybeSingle();
  const roles = await supabaseAdmin.from('user_roles').select('user_id,role');
  if (key.error || roles.error) throw new Error('Could not load scheduler configuration');
  const ids = [...new Set((roles.data ?? []).filter(r => r.role === 'staff' && !(roles.data ?? []).some(a => a.user_id === r.user_id && ['admin', 'superadmin'].includes(a.role))).map(r => r.user_id))];
  const staffAccounts = await Promise.all(ids.map(async id => {
    const result = await supabaseAdmin.auth.admin.getUserById(id);
    if (result.error || !result.data.user) throw new Error('Could not load staff accounts');
    return { id, label: result.data.user.email ?? 'Staff account' };
  }));
  return { userId: context.userId, isAdmin: admin.data === true, config: config.data,
    devices: devices.data ?? [], attempts: attempts.data ?? [], staffAccounts,
    publicKey: key.data?.public_key ?? null,
    secureStorageConfigured: !!process.env.SCHEDULING_PUSH_KEY_ENCRYPTION_SECRET,
    cronConfigured: !!process.env.SCHEDULING_PUSH_CRON_SECRET,
    // No background job created or armed by configuration/consent actions.
    backgroundJobActive: false };
});

export const setupSchedulingPushKeys = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const admin = await context.supabase.rpc('is_admin', { _user_id: context.userId });
  if (admin.error || !admin.data) throw new Error('Admin access required');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { provisionPushKeys } = await import('./scheduling-push.server');
  await provisionPushKeys(supabaseAdmin, process.env.SCHEDULING_PUSH_KEY_ENCRYPTION_SECRET);
  return { configured: true };
});

export const saveSchedulingPushConfig = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ scheduler: z.uuid().nullable(), enabled: z.boolean(), start: z.string().regex(/^\d{2}:\d{2}$/).nullable(), end: z.string().regex(/^\d{2}:\d{2}$/).nullable() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc('configure_scheduling_push', { p_scheduler: data.scheduler as string,
      p_enabled: data.enabled, p_start: data.start as string, p_end: data.end as string });
    if (result.error) throw new Error(result.error.message);
    return { saved: true };
  });

export const registerSchedulingDevice = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ subscription: subscriptionSchema, origin: z.literal(PUSH_ORIGIN), label: z.string().trim().min(1).max(80) }))
  .handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('is_staff', { _user_id: context.userId });
    if (role.error || !role.data) throw new Error('Staff access required');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const key = await supabaseAdmin.from('scheduling_push_secrets').select('public_key').maybeSingle();
    if (!key.data) throw new Error('Admin must prepare notification keys first');
    const existing = await supabaseAdmin.from('scheduling_push_devices').select('id,user_id').eq('endpoint', data.subscription.endpoint).maybeSingle();
    if (existing.error) throw new Error('Could not verify this device');
    if (existing.data && existing.data.user_id !== context.userId) throw new Error('This device belongs to another account; disable it there first');
    const count = await supabaseAdmin.from('scheduling_push_devices').select('id', { count: 'exact', head: true }).eq('user_id', context.userId);
    if (count.error || (!existing.data && (count.count ?? 0) >= 10)) throw new Error('Device limit reached');
    const result = await supabaseAdmin.from('scheduling_push_devices').upsert({ user_id: context.userId, endpoint: data.subscription.endpoint,
      p256dh: data.subscription.keys.p256dh, auth_key: data.subscription.keys.auth, label: data.label,
      origin: data.origin, enabled: true, last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' }).select('id').single();
    if (result.error || !result.data) throw new Error('Could not register your device');
    return { id: result.data.id };
  });

export const removeSchedulingDevice = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.uuid() })).handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('is_staff', { _user_id: context.userId });
    if (role.error || !role.data) throw new Error('Staff access required');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const result = await supabaseAdmin.from('scheduling_push_devices').delete().eq('id', data.id).eq('user_id', context.userId).select('id');
    if (result.error || !result.data?.length) throw new Error('This device is not registered to your account');
    return { removed: true };
  });

export const testSchedulingPush = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ deviceId: z.uuid() })).handler(async ({ data, context }) => {
    const role = await context.supabase.rpc('is_staff', { _user_id: context.userId });
    if (role.error || !role.data) throw new Error('Staff access required');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { selfTestPush } = await import('./scheduling-push.server');
    return { status: await selfTestPush(supabaseAdmin, context.userId, data.deviceId, process.env.SCHEDULING_PUSH_KEY_ENCRYPTION_SECRET) };
  });

export const getSchedulingFollowups = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const result = await context.supabase.from('scheduling_followups').select('*, clients(first_name,last_name)').order('due_at');
  if (result.error) throw new Error('Could not load scheduling follow-ups');
  return result.data;
});

export const saveSchedulingFollowup = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.uuid().nullable(), clientId: z.uuid().nullable(), ownerId: z.uuid().nullable(), due: z.iso.datetime().nullable(), context: z.string().trim().max(1000).nullable(), outcome: z.string().trim().min(1).max(1000).nullable() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc('save_scheduling_followup', { p_id: data.id as string, p_client: data.clientId as string,
      p_owner: data.ownerId as string, p_due: data.due as string, p_context: data.context as string, p_outcome: data.outcome as string });
    if (result.error) throw new Error(result.error.message);
    return { id: result.data };
  });