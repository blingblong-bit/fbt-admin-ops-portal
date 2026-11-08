import { Link, useRouterState } from '@tanstack/react-router';
import { CalendarDays, ListChecks, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ScheduleNavigation({ view = 'appointments' }: { view?: 'appointments' | 'worklists' }) {
  const path = useRouterState({ select: s => s.location.pathname });
  return <nav aria-label="Schedule views" className="mb-5 grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
    <Button asChild variant={path === '/schedule-check' && view === 'appointments' ? 'default' : 'ghost'} className="h-auto min-h-11 min-w-0 flex-col gap-1 px-1 text-xs sm:flex-row sm:text-sm"><Link to="/schedule-check" search={{ view: 'appointments' }} aria-current={path === '/schedule-check' && view === 'appointments' ? 'page' : undefined}><CalendarDays />Appointments</Link></Button>
    <Button asChild variant={path === '/schedule-check' && view === 'worklists' ? 'default' : 'ghost'} className="h-auto min-h-11 min-w-0 flex-col gap-1 px-1 text-xs sm:flex-row sm:text-sm"><Link to="/schedule-check" search={{ view: 'worklists' }} aria-current={path === '/schedule-check' && view === 'worklists' ? 'page' : undefined}><ListChecks />Worklists</Link></Button>
    <Button asChild variant={path === '/follow-ups' ? 'default' : 'ghost'} className="h-auto min-h-11 min-w-0 flex-col gap-1 px-1 text-xs sm:flex-row sm:text-sm"><Link to="/follow-ups" search={{ task: undefined }} aria-current={path === '/follow-ups' ? 'page' : undefined}><CalendarClock />Follow-ups</Link></Button>
  </nav>;
}