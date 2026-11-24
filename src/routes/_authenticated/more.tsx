import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Settings, LogOut, ShieldCheck, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { SquareCustomerBackfill } from '@/components/SquareCustomerBackfill';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/integrations/supabase/client';
import { hubHead } from '@/lib/hub-navigation';

export const Route = createFileRoute('/_authenticated/more')({ head: () => hubHead('More', 'Account, notifications, visit automation and authorized administration.'), component: MorePage });
const tools = [['/backup','Backups'],['/sync-log','Sync Log'],['/square-diagnostic','Square Diagnostic'],['/merge-center','Merge Center'],['/clients/deleted','Deleted Clients'],['/payment-history','Payment History'],['/renewal-review','Renewal Review']] as const;
function MorePage() {
  const { isAdmin, isLoading } = useRole(); const qc = useQueryClient(); const navigate = useNavigate(); const [email,setEmail] = useState('');
  useEffect(() => { supabase.auth.getUser().then(r => setEmail(r.data.user?.email ?? '')); },[]);
  return <AppShell><div className="mx-auto max-w-3xl space-y-8"><h1 className="text-2xl font-semibold">More</h1>
    <section><h2 className="mb-3 text-sm font-semibold text-muted-foreground">ACCOUNT</h2><p className="mb-3 break-all text-sm">{email}</p><Button variant="outline" className="min-h-11" onClick={async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); navigate({to:'/auth',replace:true}); }}><LogOut />Sign out</Button></section>
    <section><h2 className="mb-3 text-sm font-semibold text-muted-foreground">NOTIFICATIONS & SETTINGS</h2><Button asChild variant="outline" className="min-h-12 w-full justify-start"><Link to="/notifications"><Bell />Notifications & device settings<Settings className="ml-auto" /></Link></Button></section>
    {isLoading && <p role="status">Loading access…</p>}{isAdmin && <><section><h2 className="mb-3 text-sm font-semibold text-muted-foreground">VISIT AUTOMATION</h2><Button asChild variant="outline" className="min-h-12 w-full justify-start"><Link to="/visit-automation-review"><ShieldCheck />Visit Automation<ArrowRight className="ml-auto" /></Link></Button></section>
    <section><h2 className="mb-3 text-sm font-semibold text-muted-foreground">ADMINISTRATION</h2><div className="grid gap-2 sm:grid-cols-2">{tools.map(([to,label]) => <Button asChild key={to} variant="outline" className="min-h-11 justify-start"><Link to={to}>{label}<ArrowRight className="ml-auto" /></Link></Button>)}<SquareCustomerBackfill /></div></section></>}
  </div></AppShell>;
}
