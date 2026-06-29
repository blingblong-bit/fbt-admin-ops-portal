import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const nav = [
    { to: "/", label: "Dashboard" },
    { to: "/clients", label: "All Clients" },
    { to: "/clients/new", label: "Add Client" },
    { to: "/clients/deleted", label: "Deleted" },
    { to: "/import", label: "Import" },
    { to: "/backup", label: "Backup" },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              FB
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">FIT Beyond Therapy</div>
              <div className="text-xs text-slate-500">Admin · Package Tracking</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 data-[status=active]:bg-slate-900 data-[status=active]:text-white"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
