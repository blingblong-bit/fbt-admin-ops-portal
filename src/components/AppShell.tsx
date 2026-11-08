import { Link, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { LayoutDashboard, Users, CalendarDays, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useScrollMemory } from '@/hooks/useScrollMemory';
import { Button } from '@/components/ui/button';
import { hubSection } from '@/lib/hub-navigation';

const sections = [
  { key: 'dash', to: '/', label: 'Dash', icon: LayoutDashboard },
  { key: 'clients', to: '/clients', label: 'Clients', icon: Users },
  { key: 'schedule', to: '/schedule-check', label: 'Schedule', icon: CalendarDays },
  { key: 'messaging', to: '/messaging', label: 'Messaging', icon: MessageSquare },
  { key: 'more', to: '/more', label: 'More', icon: MoreHorizontal },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: s => s.location.pathname });
  const active = hubSection(path);
  const [collapsed, setCollapsed] = useState(false);
  useScrollMemory();
  return <div className="hub-shell min-h-dvh bg-muted/30 text-foreground">
    <a href="#hub-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-3">Skip to content</a>
    <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r bg-sidebar lg:flex lg:flex-col ${collapsed ? 'w-20' : 'w-56'}`}>
      <Link to="/" className="flex min-h-20 min-w-0 items-center gap-3 border-b px-5 py-4"><img src="/icons/fit-hub-180.png" alt="FIT Hub" className="size-9 shrink-0 rounded-md" />{!collapsed && <span className="min-w-0 text-sm font-semibold">FIT Beyond Therapy<span className="block text-xs font-normal text-muted-foreground">Staff Hub</span></span>}</Link>
      <nav aria-label="Main navigation" className="space-y-2 p-3">{sections.map(n => <Button key={n.key} asChild variant={active === n.key ? 'default' : 'ghost'} className={`h-12 w-full ${collapsed ? 'px-0' : 'justify-start px-3'}`}><Link to={n.to} aria-current={active === n.key ? 'page' : undefined} title={n.label}><n.icon />{!collapsed && n.label}</Link></Button>)}</nav>
      <Button variant="ghost" size="icon" className="m-4 mt-auto min-h-11 min-w-11" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button>
    </aside>
    <div className={collapsed ? 'lg:pl-20' : 'lg:pl-56'}>
      <header className="hub-mobile-header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-background px-4 py-3 lg:hidden"><Link to="/" className="flex min-w-0 items-center gap-2"><img src="/icons/fit-hub-180.png" alt="" className="size-8 shrink-0 rounded-md" /><span className="truncate text-sm font-semibold">FIT Beyond Therapy</span></Link><span className="shrink-0 text-xs text-muted-foreground">Hub</span></header>
      <main id="hub-content" tabIndex={-1} className="hub-content mx-auto min-w-0 max-w-7xl px-4 py-5 sm:px-6 lg:py-8">{children}</main>
    </div>
    <nav aria-label="Mobile main navigation" className="hub-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background lg:hidden">{sections.map(n => <Link key={n.key} to={n.to} aria-current={active === n.key ? 'page' : undefined} className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active === n.key ? 'bg-accent text-primary' : 'text-muted-foreground'}`}><n.icon className="size-5 shrink-0" /><span>{n.label}</span></Link>)}</nav>
  </div>;
}
