import { describe, expect, it } from 'vitest';
import { hubSection } from './hub-navigation';

describe('Hub sections preserve deep links', () => {
  it('keeps client details and renewals in Clients', () => {
    expect(hubSection('/clients/abc')).toBe('clients');
    expect(hubSection('/clients/new')).toBe('clients');
    expect(hubSection('/renewals')).toBe('clients');
  });
  it('keeps push task links in Schedule', () => expect(hubSection('/follow-ups')).toBe('schedule'));
  it('keeps the isolated appointment demo in Schedule', () => expect(hubSection('/schedule-demo')).toBe('schedule'));
  it('keeps old message links in Messaging', () => {
    for (const path of ['/dues-texts', '/dues-queue', '/messaging-preview']) expect(hubSection(path)).toBe('messaging');
  });
  it('keeps Collections in Dash and administration in More', () => {
    expect(hubSection('/collections')).toBe('dash');
    expect(hubSection('/visit-note-review')).toBe('more');
    expect(hubSection('/notifications')).toBe('more');
  });
});