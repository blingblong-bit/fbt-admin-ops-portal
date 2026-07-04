import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, X, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

export function AppShell({ children }: { children: ReactNode }) {
  const primaryNav = [
    { to: "/", label: "Dashboard" },
    { to: "/clients", label: "All Clients" },
    { to: "/clients/new", label: "Add Client" },
    { to: "/schedule-check", label: "Schedule Check" },
    { to: "/clients/deleted", label: "Deleted Clients" },
  ] as const;

  const adminNav = [
    { to: "/merge-center", label: "Merge Center" },
    { to: "/import", label: "Import" },
    { to: "/notes-ledger", label: "Notes Ledger" },
    { to: "/backup", label: "Backup" },
    { to: "/sync-log", label: "Sync Log" },
  ] as const;

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const { data: adminRoles } = useQuery({
    queryKey: ["user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles" as any)
        .select("role")
        .in("role", ["admin", "superadmin"]);
      if (error) {
        console.warn("user_roles query failed:", error);
        return [];
      }
      return data ?? [];
    },
  });
  const isAdmin = (adminRoles ?? []).length > 0;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const desktopLinkClass =
    "rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 data-[status=active]:bg-slate-900 data-[status=active]:text-white";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:flex lg:justify-between">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              FB
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight sm:text-base">
                FIT Beyond Therapy
              </div>
              <div className="truncate text-xs text-slate-500">Admin · Package Tracking</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {primaryNav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                className={desktopLinkClass}
              >
                {n.label}
              </Link>
            ))}
            {isAdmin && (
              <>
                <div className="mx-1 h-6 w-px bg-slate-200" />
                {adminNav.map((n) => (
                  <Link
                    key={n.to}
                    to={n.to}
                    activeOptions={{ exact: false }}
                    className={desktopLinkClass}
                  >
                    {n.label}
                  </Link>
                ))}
              </>
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {email && (
              <span className="hidden text-xs text-slate-500 xl:inline">{email}</span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="hidden rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 lg:inline-flex"
            >
              Sign out
            </button>
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="border-t bg-white lg:hidden">
            <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2 sm:px-6">
              {primaryNav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  activeOptions={{ exact: n.to === "/" }}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-3 text-base font-medium text-slate-700 hover:bg-slate-100 data-[status=active]:bg-slate-900 data-[status=active]:text-white"
                >
                  {n.label}
                </Link>
              ))}
              {isAdmin && (
                <Collapsible open={adminOpen} onOpenChange={setAdminOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-3 py-3 text-base font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <span>Admin Tools</span>
                      <ChevronDown
                        className={`h-5 w-5 shrink-0 transition-transform ${adminOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-3 flex flex-col border-l-2 border-slate-100">
                      {adminNav.map((n) => (
                        <Link
                          key={n.to}
                          to={n.to}
                          activeOptions={{ exact: false }}
                          onClick={() => setMenuOpen(false)}
                          className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 data-[status=active]:bg-slate-900 data-[status=active]:text-white"
                        >
                          {n.label}
                        </Link>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                {email && (
                  <span className="truncate text-xs text-slate-500">{email}</span>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
