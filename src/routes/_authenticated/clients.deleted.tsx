import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { amountOwed, formatCurrency, formatDate, fullName, type Client } from "@/lib/clients";

export const Route = createFileRoute("/clients/deleted")({
  head: () => ({ meta: [{ title: "Deleted Clients · FIT Beyond Therapy Admin" }] }),
  component: DeletedClientsPage,
});

function DeletedClientsPage() {
  const qc = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState<Client | null>(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients", "deleted"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Client[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["clients", "deleted"] });
  };

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ deleted_at: null } as never)
        .eq("id", id);
      if (error) throw error;
      await supabase.from("client_activities").insert({
        client_id: id,
        activity_type: "restored",
        description: "Client restored from Deleted Clients",
      });
    },
    onSuccess: () => {
      toast.success("Client restored");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purge = useMutation({
    mutationFn: async (id: string) => {
      // Remove activity log first to satisfy any FK constraints.
      await supabase.from("client_activities").delete().eq("client_id", id);
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Client permanently deleted");
      setPurgeTarget(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Deleted Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isLoading ? "Loading…" : `${clients.length} deleted`}
          </p>
        </div>
        <Link to="/clients">
          <Button variant="outline">← Back to All Clients</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>Amount Owed</TableHead>
                <TableHead>Date Deleted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{fullName(c)}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  <TableCell>{c.package_name ?? "—"}</TableCell>
                  <TableCell className={amountOwed(c) > 0 ? "font-medium text-red-600" : ""}>
                    {formatCurrency(amountOwed(c))}
                  </TableCell>
                  <TableCell>{formatDate(c.deleted_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => restore.mutate(c.id)}
                      disabled={restore.isPending}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => setPurgeTarget(c)}
                    >
                      Permanently Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    No deleted clients.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!purgeTarget} onOpenChange={(v) => !v && setPurgeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete this client?</DialogTitle>
            <DialogDescription>
              This will remove <strong>{purgeTarget ? fullName(purgeTarget) : ""}</strong> and all
              of their activity history from the database. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => purgeTarget && purge.mutate(purgeTarget.id)}
              disabled={purge.isPending}
            >
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
