import { createFileRoute, Link } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { hubHead } from '@/lib/hub-navigation';

export const Route = createFileRoute('/_authenticated/messaging')({ head: () => hubHead('Messaging', 'Dues texts and client messaging access.'), component: MessagingPage });
function MessagingPage() {
  const { isAdmin, isLoading } = useRole();
  return <AppShell><h1 className="mb-6 text-2xl font-semibold">Messaging</h1>{isLoading ? <p role="status">Loading access…</p> : isAdmin ? <Button asChild className="min-h-11"><Link to="/dues-texts"><MessageSquare />Dues Texts</Link></Button> : <p className="text-muted-foreground">Dues Texts requires administrator access.</p>}</AppShell>;
}