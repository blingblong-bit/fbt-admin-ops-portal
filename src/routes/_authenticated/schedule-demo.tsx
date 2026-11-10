import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { ScheduleAppointmentsDemo } from '@/components/ScheduleAppointmentsDemo';
import { hubHead } from '@/lib/hub-navigation';

export const Route = createFileRoute('/_authenticated/schedule-demo')({
  head: () => hubHead('Appointments Preview', 'Read-only Square appointments with separate simulated scheduling in FIT Hub.'),
  component: () => <AppShell><Button asChild variant="link" className="mb-4 px-0"><Link to="/schedule-check" search={{view:'appointments'}}><ArrowLeft />Back to live appointments</Link></Button><ScheduleAppointmentsDemo /></AppShell>,
});