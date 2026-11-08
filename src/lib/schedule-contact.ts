import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';
import { chicagoYmd, workWeekStartFromYmd, chicagoMidnightIso, addDaysYmd } from './work-week';

export function safeActorName(metadata: Record<string, unknown> | undefined) {
  const name = metadata?.display_name ?? metadata?.full_name ?? metadata?.name;
  return typeof name === 'string' && name.trim() && !name.includes('@') ? name.trim().slice(0, 80) : null;
}

export async function changeContact(db: SupabaseClient<Database>, clientId: string, actor: string, contacted: boolean, now = new Date()) {
  const week = workWeekStartFromYmd(chicagoYmd(now));
  const start = chicagoMidnightIso(week);
  const end = chicagoMidnightIso(addDaysYmd(week, 7));
  const result = await db.from('client_activities').select('id,metadata,created_at').eq('client_id',clientId).eq('activity_type','contacted').gte('created_at',start).lt('created_at',end);
  if (result.error) throw result.error;
  if (contacted) {
    if (result.data?.length) return {ok: true, changed: false};
    const user = await db.auth.getUser();
    if (user.error || user.data.user?.id !== actor) throw new Error('Staff session could not be verified');
    const name = safeActorName(user.data.user.user_metadata);
    const insert = await db.from('client_activities').insert({client_id:clientId,activity_type:'contacted',description:'Marked as contacted — from Schedule Check (This Week But Not Next Week)',metadata:{actor,actor_name:name,week_start:week},created_at:now.toISOString()});
    if (insert.error) throw insert.error;
    return {ok:true,changed:true};
  }
  for (const row of result.data ?? []) {
    const before = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
    const metadata: Json = {...before,undone_by:actor,undone_at:now.toISOString(),week_start:week};
    const update = await db.from('client_activities').update({activity_type:'contacted_undone',metadata}).eq('id',row.id).eq('activity_type','contacted');
    if (update.error) throw update.error;
  }
  return {ok:true,changed:!!result.data?.length,deleted:result.data?.length ?? 0};
}