import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRole } from "@/hooks/useRole";
import { archiveClient, checkArchiveEligibility, restoreClient } from "@/lib/archive.functions";

/** Admin-only manual Archive / Restore. Never archives automatically. */
export function ArchiveClientButton({
  clientId,
  clientName,
  archived,
  size = "default",
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
  size?: "default" | "sm";
}) {
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const check = useServerFn(checkArchiveEligibility);
  const doArchive = useServerFn(archiveClient);
  const doRestore = useServerFn(restoreClient);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!isAdmin) return null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["client", clientId] });
    qc.invalidateQueries();
  };

  if (archived) {
    return (
      <Button
        variant="outline"
        size={size}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await doRestore({ data: { client_id: clientId } });
            toast.success(`${clientName} restored`);
            refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Restore client
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size={size}
        disabled={checking || busy}
        onClick={async () => {
          setChecking(true);
          setBlocked(null);
          try {
            const r = await check({ data: { client_id: clientId } });
            if (r.allowed) setOpen(true);
            else setBlocked(r.reason);
          } catch (e) {
            setBlocked((e as Error).message);
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking ? "Checking Square…" : "Archive client"}
      </Button>
      {blocked && <p className="text-xs text-destructive">{blocked}</p>}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Square shows no upcoming appointments. They will be hidden from Active and Assessment
              views. All history, payments, packages, visits, renewals, and Square links are kept, and
              you can restore them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await doArchive({ data: { client_id: clientId } });
                  toast.success(`${clientName} archived`);
                  setOpen(false);
                  refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                  setOpen(false);
                  setBlocked((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Archive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
