import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTimeLocal } from "@/lib/clients";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/renewal-review")({
  head: () => ({ meta: [{ title: "Renewal Review · FIT Beyond Therapy Admin" }] }),
  component: RenewalReviewPage,
});

type CampaignRow = {
  id: string;
  client_id: string;
  status: string;
  last_visit_date: string | null;
  sends_count: number;
  reply_text: string | null;
  reply_at: string | null;
  created_at: string;
  clients: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    package_start_date: string | null;
    package_total_visits: number;
    visits_used: number | null;
  } | null;
};

function useCampaigns(statuses: string[]) {
  return useQuery({
    queryKey: ["renewal_campaigns", statuses.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_campaigns")
        .select("id, client_id, status, last_visit_date, sends_count, reply_text, reply_at, created_at, clients!inner(id, first_name, last_name, phone, package_start_date, package_total_visits, visits_used)")
        .in("status", statuses)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CampaignRow[];
    },
    refetchInterval: 30_000,
  });
}

function RenewalReviewPage() {
  const yesQ = useCampaigns(["yes"]);
  const manualQ = useCampaigns(["manual_review"]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Package Renewal Review
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Automated renewal-SMS results. Rows auto-clear once staff creates the new package.
        </p>
      </div>

      <Section
        title="Needs Renewal Review"
        subtitle="Client replied YES — create their new package via the client detail page."
        tone="green"
      >
        {yesQ.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (yesQ.data ?? []).length === 0 ? (
          <Empty label="No pending YES replies." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(yesQ.data ?? []).map((c) => (
              <CampaignCard key={c.id} campaign={c} showReply />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Needs Manual Follow-up"
        subtitle="No response after 3 texts, or reply was unclear. Please call/text the client directly."
        tone="amber"
      >
        {manualQ.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (manualQ.data ?? []).length === 0 ? (
          <Empty label="No manual follow-ups needed." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(manualQ.data ?? []).map((c) => (
              <CampaignCard key={c.id} campaign={c} showReply />
            ))}
          </div>
        )}
      </Section>
    </AppShell>
  );
}

function Section({ title, subtitle, tone, children }: {
  title: string; subtitle: string; tone: "green" | "amber"; children: React.ReactNode;
}) {
  const bar = tone === "green" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <div className={`h-6 w-1 rounded ${bar}`} />
        <div>
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed bg-white p-6 text-sm text-slate-500">
      {label}
    </p>
  );
}

function CampaignCard({ campaign, showReply }: { campaign: CampaignRow; showReply?: boolean }) {
  const c = campaign.clients;
  if (!c) return null;
  const name = `${c.first_name} ${c.last_name}`.trim();
  const dismiss = async () => {
    const { error } = await supabase
      .from("renewal_campaigns")
      .update({ status: "cancelled" })
      .eq("id", campaign.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Dismissed");
    }
  };
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            to="/clients/$id"
            params={{ id: c.id }}
            className="text-base font-semibold hover:underline"
          >
            {name}
          </Link>
          <span className="text-xs text-slate-500">
            {campaign.sends_count} text{campaign.sends_count === 1 ? "" : "s"} sent
          </span>
        </div>
        <div className="text-sm text-slate-600">
          {c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">📞 {c.phone}</a> : <span className="text-slate-400">No phone on file</span>}
        </div>
        <div className="text-xs text-slate-500">
          Last visit: {campaign.last_visit_date ?? "—"} · Package: {c.visits_used ?? 0}/{c.package_total_visits}
        </div>
        {showReply && campaign.reply_text && (
          <div className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
            <span className="font-medium">Reply:</span> {campaign.reply_text}
            {campaign.reply_at && (
              <span className="ml-1 text-slate-400">· {formatDateTimeLocal(campaign.reply_at)}</span>
            )}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Link to="/clients/$id" params={{ id: c.id }} className="flex-1">
            <Button size="sm" className="w-full">View Client</Button>
          </Link>
          <Button size="sm" variant="outline" onClick={dismiss}>Dismiss</Button>
        </div>
      </CardContent>
    </Card>
  );
}
