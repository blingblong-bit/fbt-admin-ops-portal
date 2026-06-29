import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { amountOwed, formatCurrency, fullName, progress, type Client } from "@/lib/clients";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({ meta: [{ title: "All Clients · FIT Beyond Therapy Admin" }] }),
  component: ClientsListPage,
});

function ClientsListPage() {
  const [search, setSearch] = useState("");
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .is("deleted_at", null)
        .order("last_name");
      if (error) throw error;
      return data as Client[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.first_name} ${c.last_name} ${c.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [search, clients]);

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">All Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? "Loading…" : `${filtered.length} of ${clients.length}`}
          </p>
        </div>
        <Link to="/clients/new">
          <Button>+ Add Client</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-md"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Amount Owed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{fullName(c)}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.package_name ?? "—"}</TableCell>
                  <TableCell>{progress(c)}</TableCell>
                  <TableCell>{c.is_scheduled ? "✅" : "⭕"}</TableCell>
                  <TableCell className={amountOwed(c) > 0 ? "font-medium text-red-600" : ""}>
                    {formatCurrency(amountOwed(c))}
                  </TableCell>
                  <TableCell>
                    <StatusBadge client={c} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link to="/clients/$id" params={{ id: c.id }}>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </Link>
                    <Link to="/clients/$id" params={{ id: c.id }} search={{ edit: 1 }}>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    No clients found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
