export type HubSection = 'dash' | 'clients' | 'schedule' | 'messaging' | 'more';

export function hubSection(path: string): HubSection {
  if (path === '/' || ['/collections', '/payment-due', '/weekly-dues'].includes(path)) return 'dash';
  if (path.startsWith('/clients') || path === '/renewals') return 'clients';
  if (['/schedule-check', '/follow-ups', '/missed-check-ins'].includes(path)) return 'schedule';
  if (['/messaging', '/dues-texts', '/dues-queue', '/messaging-preview'].includes(path)) return 'messaging';
  return 'more';
}

export function hubHead(title: string, description: string) {
  const name = `${title} · FIT Beyond Therapy Hub`;
  return { meta: [{ title: name }, { name: 'description', content: description }, { property: 'og:title', content: name }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] };
}