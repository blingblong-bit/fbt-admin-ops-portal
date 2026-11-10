import {describe, it, expect} from 'vitest';
import {demoBook, demoCancel, demoComplete, demoMove, demoOpenings, demoSlotFree, demoSwap, demoVisit, demoAddTrainer, demoPackageFor, demoUnreserved, demoWeek, initialDemoState, DEMO_DATE, type DemoAppointment} from './schedule-demo';
const slot: DemoAppointment = {id:'new-demo',clientId:'demo-2',trainer:'Avery',date:DEMO_DATE,start:660,duration:30,status:'booked'};
describe('isolated scheduling demo', () => {
  it('contains only fake identifiers and resets independently', () => {
    const state=initialDemoState(); expect(state.clients.every(c=>c.id.startsWith('demo-'))).toBe(true);
    expect(demoCancel(state,'demo-appt-0').appointments[0]?.status).toBe('cancelled');
    expect(initialDemoState().appointments[0]?.status).toBe('booked');
  });
  it('books existing packages without payment or visit consumption', () => {
    const state=initialDemoState(), next=demoBook(state,slot);
    expect(next.clients).toEqual(state.clients); expect(demoVisit(next,slot)).toBe(2);
  });
  it('offers 8/4/2/single/custom packages with editable demo price', () => {
    for(const total of [8,4,2,1,7]) {
      const state=initialDemoState(); state.appointments=[]; const client=state.clients.find(c=>c.id===slot.clientId); if(client)client.used=client.total;
      const next=demoBook(state,slot,{total,price:175});
      expect(next.clients.find(c=>c.id===slot.clientId)).toMatchObject({total,price:175,paid:0,used:0});
    }
  });
  it('rejects replacing in-use packages and invalid inputs', () => {
    expect(()=>demoBook(initialDemoState(),slot,{total:8,price:375})).toThrow('existing package');
    const state=initialDemoState(); state.appointments=[];
    for(const change of [{total:0,price:50},{total:4,price:-1},{total:1.5,price:50}]) expect(()=>demoBook(state,slot,change)).toThrow();
  });
  it('rejects trainer and client overlaps but permits adjoining slots', () => {
    const state=initialDemoState(); expect(demoSlotFree(state,{...slot,start:420})).toBe(true);
    expect(demoSlotFree(state,{...slot,start:450})).toBe(true);
    expect(()=>demoBook(state,{...slot,start:450,trainer:'Casey'})).toThrow('already has');
  });
  it('filters openings for any or selected trainers and respects hours', () => {
    const state=initialDemoState();
    expect(demoOpenings(state,DEMO_DATE,['Casey'],30).every(s=>s.trainer==='Casey')).toBe(true);
    expect(demoOpenings(state,DEMO_DATE,[],30)).toEqual([]);
    expect(demoOpenings(state,DEMO_DATE,['Avery','Jordan','Casey'],60).every(s=>s.start+s.duration<=1140)).toBe(true);
  });
  it('reschedules or changes trainer without consuming a visit', () => {
    const state=initialDemoState(), next=demoMove(state,'demo-appt-0',{...slot,start:720,trainer:'Jordan'});
    expect(next.clients).toEqual(state.clients); expect(next.appointments[0]).toMatchObject({start:720,trainer:'Jordan'});
    expect(demoMove(state,'demo-appt-0',{...slot,start:450,trainer:'Jordan'}).appointments[0]).toMatchObject({trainer:'Jordan',start:450});
  });
  it('swaps both appointments atomically and rejects self-swap', () => {
    const state=initialDemoState(), next=demoSwap(state,'demo-appt-0','demo-appt-1');
    expect(next.appointments[0]).toMatchObject({start:450,trainer:'Jordan'});
    expect(next.appointments[1]).toMatchObject({start:420,trainer:'Avery'});
    expect(next.clients).toEqual(state.clients); expect(()=>demoSwap(state,'demo-appt-0','demo-appt-0')).toThrow();
  });
  it('cancel releases reservation; completion consumes exactly one visit without credit', () => {
    const state=initialDemoState(), cancelled=demoCancel(state,'demo-appt-0');
    expect(cancelled.clients).toEqual(state.clients); expect(demoSlotFree(cancelled,{...slot,start:420})).toBe(true);
    const completed=demoComplete(state,'demo-appt-0');
    expect(completed.clients[0]).toMatchObject({used:3,paid:375});
    expect(demoComplete(completed,'demo-appt-0')).toBe(completed);
    expect(demoVisit(completed,completed.appointments[0] ?? slot)).toBe(3);
  });
  it('prevents booking beyond available package visits', () => {
    expect(()=>demoBook(initialDemoState(),{...slot,clientId:'demo-5'})).toThrow('unreserved');
  });
  it('uses explicit two-client capacity and excludes full openings', () => {
    const state=initialDemoState();
    const next=demoBook(state,{...slot,start:420});
    expect(demoSlotFree(next,{...slot,start:420})).toBe(false);
    expect(demoOpenings(next,DEMO_DATE,['Avery'],30).some(s=>s.start===420)).toBe(false);
    expect(()=>demoBook(next,{...slot,id:'third',clientId:'demo-7',start:420})).toThrow('full');
    expect(()=>demoBook(next,{...slot,id:'duplicate',start:420,trainer:'Casey'})).toThrow('already has');
  });
  it('counted cancellation consumes once, releases slot, and keeps remaining numbers unique', () => {
    const state=demoBook(initialDemoState(),slot);
    const next=demoCancel(state,'new-demo',true);
    expect(next.clients[1]).toMatchObject({used:1,paid:0});
    expect(demoCancel(next,'new-demo',true)).toBe(next);
    expect(demoComplete(next,'new-demo')).toBe(next);
    expect(next.appointments.find(a=>a.id==='new-demo')).toMatchObject({status:'cancelled',completedVisit:1});
    const first=next.appointments.find(a=>a.id==='demo-appt-1');
    if(!first)throw new Error('missing');
    expect(demoVisit(next,first)).toBe(2);
    expect(demoSlotFree(next,slot)).toBe(true);
  });
  it('fresh package preserves reservations, historical money and numbering', () => {
    const state=initialDemoState();
    const old=state.appointments.find(a=>a.clientId==='demo-5');
    if(!old)throw new Error('missing');
    const next=demoBook(state,{...slot,clientId:'demo-5'},{total:4,price:175});
    const c=next.clients.find(c=>c.id==='demo-5');
    if(!c)throw new Error('missing');
    expect(c).toMatchObject({total:4,used:0,price:175,paid:0});
    expect(c.history).toEqual([{id:'demo-5-package-1',total:1,used:0,price:50,paid:0}]);
    expect(demoVisit(next,old)).toBe(1);
    expect(demoPackageFor(c,old.packageId).total).toBe(1);
    const booked=next.appointments.find(a=>a.id===slot.id);
    if(!booked)throw new Error('missing');
    expect(demoVisit(next,booked)).toBe(1);
    expect(demoUnreserved(next,c)).toBe(3);
    const completed=demoComplete(next,old.id);
    expect(completed.clients.find(x=>x.id===c.id)).toMatchObject({used:0,history:[{used:1,price:50,paid:0}]});
  });
  it('swap conflicts reject both changes atomically', () => {
    const state=initialDemoState();
    state.appointments.push({id:'conflict',clientId:'demo-1',trainer:'Casey',date:DEMO_DATE,start:450,duration:30,status:'booked'});
    const before=structuredClone(state);
    expect(()=>demoSwap(state,'demo-appt-0','demo-appt-1')).toThrow('conflict');
    expect(state).toEqual(before);
    expect(()=>demoSwap(state,'demo-appt-0','conflict')).toThrow('different clients');
  });
  it('admin-only trainer addition does not modify clients or permissions', () => {
    const state=initialDemoState();
    expect(()=>demoAddTrainer(state,'New Trainer',false)).toThrow('admins');
    const next=demoAddTrainer(state,'  New Trainer  ',true);
    expect(next.trainers).toEqual(['Avery','Jordan','Casey','New Trainer']);
    expect(next.clients).toBe(state.clients);expect(next.appointments).toBe(state.appointments);
    expect(()=>demoAddTrainer(next,'new trainer',true)).toThrow('unique');
  });
  it('week strip is Sunday through Saturday across year boundaries', () => {
    expect(demoWeek(DEMO_DATE)).toEqual(['2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14']);
    expect(demoWeek('2027-01-01')[0]).toBe('2026-12-27');
  });
});