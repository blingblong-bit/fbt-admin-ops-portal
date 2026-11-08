import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { changeContact, safeActorName } from './schedule-contact';

function fixture(existing: Array<{id:string;metadata:Record<string,unknown>;created_at:string}> = [], fail = false) {
  const rows = structuredClone(existing);
  let inserts = 0;
  const db = {
    auth: {getUser:async () => ({data:{user:{id:'staff',user_metadata:{display_name:'Zane'}}},error:null})},
    from: () => ({
      select: () => { const chain = {eq: () => chain, then: (resolve: (value:unknown)=>unknown) => Promise.resolve({data:rows,error:fail?new Error('Denied'):null}).then(resolve)};return chain; },
      insert: async (row:Record<string,unknown>) => {inserts++;rows.push({id:'new',metadata:row.metadata as Record<string,unknown>,created_at:row.created_at as string});return {error:null};},
      update: (patch:Record<string,unknown>) => {const chain = {eq: (key:string,id:string) => {if(key==='id'){const row=rows.find(r=>r.id===id);if(row) Object.assign(row,patch);} return chain;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return chain;},
    }),
  } as unknown as SupabaseClient<Database>;
  return {db,rows,inserts:()=>inserts};
}

describe('authenticated contact action persistence (local fixtures)', () => {
  it('records the server actor and next work week on Saturday without a reminder', async () => {
    const f=fixture();await changeContact(f.db,'client','staff',true,new Date('2026-11-08T03:00:00Z'));
    expect(f.rows[0].metadata).toEqual({actor:'staff',actor_name:'Zane',week_start:'2026-11-09'});
    expect(f.inserts()).toBe(1);
  });
  it('ignores a retry when this week already has a contact', async () => {
    const f=fixture([{id:'old',metadata:{week_start:'2026-11-09'},created_at:'2026-11-08T03:00:00Z'}]);
    const r=await changeContact(f.db,'client','staff',true,new Date('2026-11-09T18:00:00Z'));
    expect(r.changed).toBe(false);expect(f.inserts()).toBe(0);
  });
  it('allows authorized staff undo of another actor and preserves original history', async () => {
    const f=fixture([{id:'old',metadata:{actor:'other',actor_name:'Other Staff',week_start:'2026-11-09'},created_at:'2026-11-08T03:00:00Z'}]);
    await changeContact(f.db,'client','staff',false,new Date('2026-11-09T18:00:00Z'));
    expect(f.rows[0]).toMatchObject({activity_type:'contacted_undone',created_at:'2026-11-08T03:00:00Z',metadata:{actor:'other',undone_by:'staff',actor_name:'Other Staff'}});
  });
  it('does not undo earlier-week history', async () => {
    const f=fixture([{id:'old',metadata:{week_start:'2026-11-02'},created_at:'2026-11-02T18:00:00Z'}]);
    const r=await changeContact(f.db,'client','staff',false,new Date('2026-11-09T18:00:00Z'));
    expect(r.changed).toBe(false);expect(f.rows[0].metadata.undone_by).toBeUndefined();
  });
  it('propagates RLS denial instead of reporting success', async () => {
    const f=fixture([],true);await expect(changeContact(f.db,'client','staff',true)).rejects.toThrow('Denied');expect(f.inserts()).toBe(0);
  });
  it('does not use email as a display name', () => {
    expect(safeActorName({display_name:'private@example.com'})).toBeNull();expect(safeActorName(undefined)).toBeNull();
  });
});