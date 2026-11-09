import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { ScheduleAppointmentsDemo } from '@/components/ScheduleAppointmentsDemo';
import { hubHead } from '@/lib/hub-navigation';

export const Route = createFileRoute('/_authenticated/schedule-demo')({
  head: () => hubHead('Isolated Appointments Demo', 'Fake-client scheduling demo; the live FIT Hub schedule remains separate.'),
  component: () => <AppShell><Button asChild variant="link" className="mb-4 px-0"><Link to="/schedule-check" search={{view:'appointments'}}><ArrowLeft />Back to live appointments</Link></Button><ScheduleAppointmentsDemo /></AppShell>,
});