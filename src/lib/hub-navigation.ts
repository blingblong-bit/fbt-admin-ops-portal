export const hubSections = [
  { key: 'dash', to: '/', label: 'Dash' },
  { key: 'clients', to: '/clients', label: 'Clients' },
  { key: 'schedule', to: '/schedule-check', label: 'Schedule' },
  { key: 'dues', to: '/dues', label: 'Dues' },
  { key: 'more', to: '/more', label: 'More' },
] as const;

export type HubSection = typeof hubSections[number]['key'];

export const retiringScreens = [
  { to: '/collections', label: 'Collections' },
  { to: '/renewals', label: 'Renewals' },
  { to: '/payment-due', label: 'Payment Due' },
  { to: '/weekly-dues', label: 'Weekly Dues' },
  { to: '/dues-texts', label: 'Dues Texts' },
  { to: '/dues-queue', label: 'Dues Queue' },
  { to: '/messaging', label: 'Messaging' },
  { to: '/messaging-preview', label: 'Messaging Preview' },
  { to: '/missed-check-ins', label: 'Missed Check-Ins' },
  { to: '/visit-note-review', label: 'Visit Note Review' },
  { to: '/visit-automation-review', label: 'Visit Automation Review' },
  { to: '/sync-log', label: 'Payments Review' },
  { to: '/payment-history', label: 'Payment History' },
  { to: '/renewal-review', label: 'Renewal / Manual Follow-up Review' },
] as const;

export function oldScreensFor(isAdmin: boolean) {
  return isAdmin ? retiringScreens : [];
}

export function hubSection(path: string): HubSection {
  if (path === '/') return 'dash';
  if (path.startsWith('/clients')) return 'clients';
  if (['/schedule-check', '/schedule-demo', '/follow-ups'].includes(path)) return 'schedule';
  if (path === '/dues') return 'dues';
  return 'more';
}

export function hubHead(title: string, description: string) {
  const name = `${title} · FIT Beyond Therapy Hub`;
  return { meta: [{ title: name }, { name: 'description', content: description }, { property: 'og:title', content: name }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] };
}