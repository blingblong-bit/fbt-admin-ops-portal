import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requireAdmin } from "@/lib/require-admin";
import { formatCurrency, fullName, progress } from "@/lib/clients";
import {
  getDuesQueue,
  getMessagingFlag,
  generateDuesPreviews,
  getSmsEligibilityCounts,
} from "@/lib/dues-messaging.functions";
import { buildBalanceDraft, smsEligibility, statusLabel } from "@/lib/dues-messaging";
import { SendingDisabledBanner, SmsEligibilityPill } from "@/components/DuesMessageList";

export const Route = createFileRoute("/_authenticated/dues-queue")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [
      { title: "Send Dues Message · FIT Beyond Therapy Admin" },
      {
        name: "description",
        content: "Package clients with an unpaid balance and their drafted reminder texts.",
      },
      { property: "og:title", content: "Send Dues Message · FIT Beyond Therapy Admin" },
      {
        property: "og:description",
        content: "Package clients with an unpaid balance and their drafted reminder texts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DuesQueuePage,
});

function DuesQueuePage() {
  const qc = useQueryClient();
  const queueFn = useServerFn(getDuesQueue);
  const flagFn = useServerFn(getMessagingFlag);
  const genFn = useServerFn(generateDuesPreviews);
  const [preview, setPreview] = useState<{ name: string; body: string; warnings: string[] } | null>(
    null,
  );

  const countsFn = useServerFn(getSmsEligibilityCounts);
  const flag = useQuery({ queryKey: ["messaging-flag"], queryFn: () => flagFn() });
  const queue = useQuery({ queryKey: ["dues-queue"], queryFn: () => queueFn() });
  const counts = useQuery({ queryKey: ["sms-eligibility-counts"], queryFn: () => countsFn() });

  const generate = useMutation({
    mutationFn: () => genFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Drafts refreshed — ${r.created} new, ${r.updated} updated. Nothing sent.`);
      qc.invalidateQueries({ queryKey: ["dues-queue"] });
      qc.invalidateQueries({ queryKey: ["dues-messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = queue.data?.rows ?? [];

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Send Dues Message</h1>
      <p className="mb-4 text-sm text-slate-500">
        Package clients who currently owe money. Messages are drafted only.
      </p>
      <SendingDisabledBanner enabled={flag.data?.sendingEnabled ?? false} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? "Refreshing…" : "Generate / Refresh Drafts"}
        </Button>
        <Link to="/messaging-preview" className="text-sm font-medium text-slate-600 underline">
          Messaging Preview
        </Link>
      </div>

      {counts.data && (
        <div className="mb-4 flex flex-wrap gap-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          <span>Consented: {counts.data.consented}</span>
          <span>Not consented: {counts.data.not_consented}</span>
          <span>Opted out: {counts.data.opted_out}</span>
          <span>Invalid or missing phone: {counts.data.invalid_phone}</span>
        </div>
      )}

      {queue.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nobody currently owes a confirmed balance.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ client, current_owed, previous_owed, total_owed, last_message }) => {
            const draft = buildBalanceDraft(client as never);
            return (
              <Card key={client.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    <Link to="/clients/$id" params={{ id: client.id }} className="hover:underline">
                      {fullName(client)}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="text-slate-500">
                    {client.package_name ?? "—"} · {progress(client as never)} visits
                  </div>
                  <div>Current package owed: {formatCurrency(current_owed)}</div>
                  {previous_owed > 0 && (
                    <div>Previous package owed: {formatCurrency(previous_owed)}</div>
                  )}
                  <div className="font-semibold text-red-700">
                    Total owed: {formatCurrency(total_owed)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Last message: {last_message ? statusLabel(last_message) : "None"}
                  </div>
                  <div className="pt-1">
                    <SmsEligibilityPill eligibility={smsEligibility(client as never)} />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() =>
                      setPreview({
                        name: fullName(client),
                        body: draft.body,
                        warnings: draft.warnings,
                      })
                    }
                  >
                    Preview
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Message preview — {preview?.name}</DialogTitle>
            <DialogDescription>Draft only. Nothing is sent.</DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap rounded-md border bg-slate-50 p-3 text-sm">
            {preview?.body}
          </p>
          {(preview?.warnings.length ?? 0) > 0 && (
            <ul className="list-inside list-disc text-sm text-red-600">
              {preview?.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
