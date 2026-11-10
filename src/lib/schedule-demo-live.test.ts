import { describe, it, expect } from 'vitest';
import { projectLiveAppointment } from './schedule-demo-live';
import { demoBook, demoMove, demoSwap, demoOpenings, initialDemoState, DEMO_DATE } from './schedule-demo';
import type { ScheduleAppointment } from './schedule.functions';

const live: ScheduleAppointment = { booking_id:'square-read', start_at:'2026-11-09T13:00:00Z', status:'ACCEPTED', duration_minutes:30, team_member_name:'Avery', service_name:'Training', square_customer_id:'square-customer', customer_info:{given_name:'Live',family_name:'Person',email:null,phone:null}, client:null };
describe('read-only Square display and simulated occupancy',()=>{
  it('projects Chicago time without importing live money or client IDs into simulated packages',()=>{
    const row=projectLiveAppointment(live);
    expect(row).toMatchObject({name:'Live Person',date:DEMO_DATE,start:420,duration:30});
    expect(row).not.toHaveProperty('paid');
    expect(row).not.toHaveProperty('clientId');
  });
  it('blocks simulated booking over any Square occupancy without altering live rows',()=>{
    const before=structuredClone(live),state=initialDemoState();state.appointments=[];state.readOnlySlots=[projectLiveAppointment(live).blocker];
    expect(()=>demoBook(state,{id:'demo-new',clientId:'demo-1',trainer:'Avery',date:DEMO_DATE,start:420,duration:30,status:'booked'})).toThrow('full');
    expect(demoOpenings(state,DEMO_DATE,['Avery'],30).some(s=>s.start===420)).toBe(false);
    expect(live).toEqual(before);
  });
  it('blocks simulated moves and swaps into live slots atomically',()=>{
    const state=initialDemoState();state.readOnlySlots=[{id:'read',trainer:'Jordan',date:DEMO_DATE,start:450,duration:30}];
    const before=structuredClone(state);
    expect(()=>demoMove(state,'demo-appt-0',{trainer:'Jordan',date:DEMO_DATE,start:450,duration:30})).toThrow();
    expect(()=>demoSwap(state,'demo-appt-0','demo-appt-1')).toThrow();
    expect(state).toEqual(before);
  });
  it('fails closed for unreadable availability and unknown duration',()=>{
    const state=initialDemoState();state.availabilityUnknown=true;
    expect(demoOpenings(state,DEMO_DATE,['Avery'],30)).toEqual([]);
    const row=projectLiveAppointment({...live,duration_minutes:null,team_member_name:null});
    expect(row.blocker).toMatchObject({start:0,duration:1440});expect(row.trainerUnknown).toBe(true);
  });
  it('keeps unknown checkout and visit counts out of the projection even when Hub has a package',()=>{
    const row=projectLiveAppointment({...live,client:{id:'real-id',first_name:'Live',last_name:'Client',phone:null,package_total_visits:4,visits_used:2,package_price:175,amount_paid:175,internal_notes:null,square_customer_id:'square-customer',status:'active',manual_active:null}});
    expect(row.name).toBe('Live Client');expect(row).not.toHaveProperty('visits_used');expect(row).not.toHaveProperty('amount_paid');
  });
});