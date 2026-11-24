import { describe, expect, it } from 'vitest';
import { hubSection, hubSections, oldScreensFor, retiringScreens } from './hub-navigation';

describe('Hub sections preserve deep links', () => {
  it('keeps client details in Clients', () => {
    expect(hubSection('/clients/abc')).toBe('clients');
    expect(hubSection('/clients/new')).toBe('clients');
    expect(hubSection('/renewals')).toBe('more');
  });
  it('keeps push task links in Schedule', () => expect(hubSection('/follow-ups')).toBe('schedule'));
  it('keeps the isolated appointment demo in Schedule', () => expect(hubSection('/schedule-demo')).toBe('schedule'));
  it('keeps retired deep links reachable under More', () => {
    for (const { to } of retiringScreens) expect(hubSection(to)).toBe('more');
  });
  it('selects Dues independently of dashboard and administration', () => {
    expect(hubSection('/dues')).toBe('dues');
    expect(hubSection('/')).toBe('dash');
    expect(hubSection('/collections')).toBe('more');
    expect(hubSection('/visit-note-review')).toBe('more');
    expect(hubSection('/notifications')).toBe('more');
  });
  it('uses the same five primary destinations without retired screens', () => {
    expect(hubSections.map(section => section.to)).toEqual(['/', '/clients', '/schedule-check', '/dues', '/more']);
    for (const { to } of retiringScreens) expect(hubSections.some(section => String(section.to) === to)).toBe(false);
  });
  it('retains scheduling and follow-up destination membership', () => {
    expect(hubSections.find(section => section.key === 'schedule')?.to).toBe('/schedule-check');
    expect(hubSection('/follow-ups')).toBe('schedule');
  });
  it('exposes all retired links to admins only', () => {
    expect(oldScreensFor(false)).toEqual([]);
    expect(oldScreensFor(true).map(screen => screen.to)).toEqual([
      '/collections', '/renewals', '/payment-due', '/weekly-dues', '/dues-texts', '/dues-queue',
      '/messaging', '/messaging-preview', '/missed-check-ins', '/visit-note-review',
      '/visit-automation-review', '/sync-log', '/payment-history', '/renewal-review',
    ]);
  });
});