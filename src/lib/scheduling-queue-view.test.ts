import { describe, expect, it } from 'vitest';
import { outreachState, primaryQueueIds, type QueueTask } from './scheduling-queue-view';

const week = '2026-11-09';
const task: QueueTask = { id: 'task', client_id: 'c', owner_id: 'staff', due_at: '2026-11-10T16:00:00Z', status: 'open', context: 'This Week but Not Next [rebooking:2026-11-09]: Called; awaiting reply', created_at: '2026-11-08T03:00:00Z' };
describe('rebooking presentation', () => {
  it('does not call a contact alone waiting or done', () => {
    const s = outreachState('c',week,[],[{client_id:'c',activity_type:'contacted',created_at:'2026-11-09T16:00:00Z',description:'Contacted'}],'2026-11-09T18:00:00Z');
    expect(s.group).toBe('outreach'); expect(s.contacted).toBe(true);
  });
  it('waits only with a linked open task, owner and due time', () => {
    expect(outreachState('c',week,[task],[],'2026-11-09T18:00:00Z').group).toBe('waiting');
    expect(outreachState('c',week,[{...task,owner_id:''}],[],'2026-11-09T18:00:00Z').group).toBe('outreach');
  });
  it('brings due waiting tasks back for action without completing them', () => {
    const s = outreachState('c',week,[task],[],'2026-11-10T17:00:00Z'); expect(s.due).toBe(true); expect(s.task?.status).toBe('open');
  });
  it('does not reuse an old week or completed task', () => {
    expect(outreachState('c','2026-11-16',[task],[],'2026-11-16T17:00:00Z').group).toBe('outreach');
    expect(outreachState('c',week,[{...task,status:'completed'}],[],'2026-11-10T17:00:00Z').group).toBe('outreach');
  });
  it('unavailable closes only its week and retains the reason', () => {
    const a = [{client_id:'c',activity_type:'unavailable_next_week',created_at:'2026-11-09T16:00:00Z',description:'Vacation'}];
    expect(outreachState('c',week,[task],a,'2026-11-10T17:00:00Z').reason).toBe('Vacation');
    expect(outreachState('c','2026-11-16',[task],a,'2026-11-16T17:00:00Z').group).toBe('outreach');
  });
  it('keeps each candidate once, including legacy no-booking candidates', () => {
    const groups = primaryQueueIds(['a'],['a','b'],['c'],['c','d','legacy'],['a','e'],['f']);
    expect(groups).toEqual({rebooking:['a'],completed:['b'],lastWeek:['c'],notScheduled:['d','legacy'],onlyOnce:['e'],hidden:['f']});
  });
  it('does not confuse another client task or generic task with outreach', () => {
    expect(outreachState('other',week,[task],[],'2026-11-10T17:00:00Z').group).toBe('outreach');
    expect(outreachState('c',week,[{...task,context:'Not Scheduled: call'}],[],'2026-11-10T17:00:00Z').group).toBe('outreach');
  });
});