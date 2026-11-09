import {describe, it, expect} from 'vitest';
import {demoBook, demoCancel, demoComplete, demoMove, demoOpenings, demoSlotFree, demoSwap, demoVisit, initialDemoState, DEMO_DATE, type DemoAppointment} from './schedule-demo';
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
      const state=initialDemoState(); state.appointments=[];
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
    const state=initialDemoState(); expect(demoSlotFree(state,{...slot,start:420})).toBe(false);
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
    expect(()=>demoMove(state,'demo-appt-0',{...slot,start:450,trainer:'Jordan'})).toThrow('unavailable');
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
});