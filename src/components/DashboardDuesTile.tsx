import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, ArrowRight } from "lucide-react";
import { simpleDuesQuery } from "@/lib/simple-dues.functions";
import { simpleDuesAttentionCounts } from "@/lib/simple-dues";
import { formatCurrency } from "@/lib/clients";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { DuesFreshnessBanner } from "@/components/DuesFreshnessBanner";

export function DashboardDuesTile() {
  const { isAdmin, isLoading } = useRole();
  // Preserve the existing aggregate-read permission; never query as staff.
  const q = useQuery({ ...simpleDuesQuery(), enabled: isAdmin });
  return <div className="flex min-w-0 flex-col rounded-md border-2 border-primary bg-card p-5 text-card-foreground">
    <Button asChild variant="ghost" className="mb-3 h-auto justify-between p-0 text-left text-lg font-semibold hover:bg-transparent">
      <Link to="/dues"><span className="flex items-center gap-2"><CircleDollarSign className="size-6" />Dues</span><ArrowRight className="size-5" /></Link>
    </Button>
    {isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading access…</p> : !isAdmin ? <p className="text-sm text-muted-foreground">Admin access required for totals</p> : <>
      <DuesFreshnessBanner q={q} />
      {q.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading dues…</p> : !q.data ? <p role="alert" className="text-sm text-destructive">Dues could not load. <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></p> : !q.data.cutoverDate ? <p role="status" className="text-sm text-muted-foreground">Cutover not set</p> : <>
        <Link to="/dues" search={{list:"who-owes"}} className="text-3xl font-semibold tabular-nums hover:underline">{formatCurrency(q.data.totalOwed)}</Link>
        <p className="mt-1 text-sm text-muted-foreground">total owed · <Link to="/dues" search={{list:"who-owes"}} className="font-semibold text-foreground hover:underline">{q.data.owingCount}</Link> {q.data.owingCount === 1 ? "client owing" : "clients owing"}</p>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">{q.data.bookingError?<span>Renew soon and missing packages unavailable</span>:<><Link to="/dues" search={{list:"renew-soon"}} className="hover:underline">{simpleDuesAttentionCounts(q.data).renewSoon} renew soon</Link><span>·</span><Link to="/dues" search={{list:"needs-package"}} className="hover:underline">{simpleDuesAttentionCounts(q.data).needsPackage} need a package</Link></>}<span>·</span><Link to="/dues" search={{list:"flagged"}} className="hover:underline">{simpleDuesAttentionCounts(q.data).flagged} flagged</Link></div>
      </>}
    </>}
  </div>;
}