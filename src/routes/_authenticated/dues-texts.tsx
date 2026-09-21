import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/require-admin";
import { formatCurrency, formatDate } from "@/lib/clients";
import {
  getDuesTextsBoard,
  getMessagingFlag,
  generateDuesPreviews,
  sendDuesMessageNow,
} from "@/lib/dues-messaging.functions";
import { messageShowsAmount, messageTypeLabel, statusLabel } from "@/lib/dues-messaging";
import { SendingDisabledBanner, SmsEligibilityPill } from "@/components/DuesMessageList";
import type { BoardCard, ReadyCard } from "@/lib/dues-texts-board";

export const Route = createFileRoute("/_authenticated/dues-texts")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [
      { title: "Dues Texts · FIT Beyond Therapy Admin" },
      {
        name: "description",
        content:
          "Review and send dues, renewal and opt-in confirmation texts from one operational page.",
      },
      { property: "og:title", content: "Dues Texts · FIT Beyond Therapy Admin" },
      {
        property: "og:description",
        content:
          "Review and send dues, renewal and opt-in confirmation texts from one operational page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DuesTextsPage,
});

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold tracking-tight">
        {title} <span className="text-slate-400">({count})</span>
      </h2>
      <p className="mb-3 text-sm text-slate-500">{description}</p>
      {children}
    </section>
  );
}

function ClientLine({ card }: { card: BoardCard }) {
  const bits = [
    card.packageName ?? null,
    card.visitsTotal ? `${card.visitsUsed ?? 0}/${card.visitsTotal} visits` : null,
    card.renewalStartDate ? `Starts ${formatDate(card.renewalStartDate)}` : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/clients/$id"
        params={{ id: card.clientId }}
        className="text-base font-semibold hover:underline"
      >
        {card.clientName}
      </Link>
      <span className="rounded-full border bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
        {messageTypeLabel(card.messageType)}
      </span>
      <SmsEligibilityPill eligibility={card.eligibility} />
      {bits.length > 0 && <span className="text-xs text-slate-500">{bits.join(" · ")}</span>}
    </div>
  );
}

function Preview({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap rounded-md border bg-slate-50 p-3 text-sm text-slate-700">
      {body}
    </p>
  );
}

function DuesTextsPage() {
  const qc = useQueryClient();
  const boardFn = useServerFn(getDuesTextsBoard);
  const flagFn = useServerFn(getMessagingFlag);
  const genFn = useServerFn(generateDuesPreviews);
  const sendFn = useServerFn(sendDuesMessageNow);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const flag = useQuery({ queryKey: ["messaging-flag"], queryFn: () => flagFn() });
  const board = useQuery({ queryKey: ["dues-texts-board"], queryFn: () => boardFn() });
  const sendingEnabled = flag.data?.sendingEnabled ?? false;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["dues-texts-board"] });
    qc.invalidateQueries({ queryKey: ["dues-queue"] });
    qc.invalidateQueries({ queryKey: ["dues-messages"] });
    qc.invalidateQueries({ queryKey: ["dues-texts-counts"] });
  };

  const generate = useMutation({
    mutationFn: () => genFn({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Drafts refreshed — ${r.created} new, ${r.updated} updated. Nothing sent.`);
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: (messageId: string) => sendFn({ data: { messageId } }),
    onSuccess: (r) => {
      if (r.sent) toast.success("Message sent.");
      else toast.error(r.reason ?? "Nothing was sent.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSendingId(null),
  });

  const doSend = (id: string) => {
    setSendingId(id);
    send.mutate(id);
  };

  const data = board.data;

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Dues Texts</h1>
      <p className="mb-4 text-sm text-slate-500">
        Review the wording and amount, then send. Everything is re-checked against live records
        at send time.
      </p>
      <SendingDisabledBanner enabled={sendingEnabled} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? "Refreshing…" : "Refresh Drafts"}
        </Button>
        <Link to="/dues-queue" className="text-sm font-medium text-slate-600 underline">
          Send Dues Message queue
        </Link>
        <Link to="/messaging-preview" className="text-sm font-medium text-slate-600 underline">
          Messaging Preview
        </Link>
      </div>

      {board.isLoading || !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <Section
            title="Ready to Send"
            description="Passes every check right now."
            count={data.counts.ready}
          >
            {data.ready.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing is waiting to send.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {data.ready.map((c: ReadyCard) => (
                  <Card key={c.id}>
                    <CardContent className="space-y-2 p-4">
                      <ClientLine card={c} />
                      {messageShowsAmount(c.messageType) && (
                        <div className="text-sm font-semibold text-red-700">
                          Amount due: {formatCurrency(c.amountDue)}
                        </div>
                      )}
                      {c.requiresConfirmationFirst ? (
                        <>
                          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                            Confirmation required first — this client has not received their
                            opt-in confirmation yet.
                          </div>
                          <Preview body={c.confirmationBody ?? ""} />
                          <Button
                            size="sm"
                            disabled={!sendingEnabled || sendingId === c.confirmationId}
                            onClick={() => c.confirmationId && doSend(c.confirmationId)}
                          >
                            {sendingId === c.confirmationId ? "Sending…" : "Send Confirmation"}
                          </Button>
                          <details className="text-xs text-slate-500">
                            <summary className="cursor-pointer">Show the dues message</summary>
                            <p className="mt-2 whitespace-pre-wrap">{c.body}</p>
                          </details>
                        </>
                      ) : (
                        <>
                          <Preview body={c.body} />
                          <Button
                            size="sm"
                            disabled={!sendingEnabled || sendingId === c.id}
                            onClick={() => doSend(c.id)}
                          >
                            {sendingId === c.id ? "Sending…" : "Send Now"}
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Blocked"
            description="Drafted, but cannot be sent until the reason is fixed."
            count={data.counts.blocked}
          >
            {data.blocked.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing blocked.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {data.blocked.map((c: BoardCard) => (
                  <Card key={c.id}>
                    <CardContent className="space-y-2 p-4">
                      <ClientLine card={c} />
                      <ul className="list-inside list-disc text-sm text-red-600">
                        {(c.warnings.length > 0 ? c.warnings : ["Blocked"]).map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.clientId }}
                        className="inline-block text-sm font-medium text-slate-700 underline"
                      >
                        {blockedActionLabel(c.warnings)}
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Sent / Delivered"
            description="Sent in the last 7 days. Full history stays on each client's Messages tab."
            count={data.sent.length}
          >
            {data.sent.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing sent in the last 7 days.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-white text-sm">
                {data.sent.map((c: BoardCard) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <Link
                      to="/clients/$id"
                      params={{ id: c.clientId }}
                      className="font-medium hover:underline"
                    >
                      {c.clientName}
                    </Link>
                    <span className="text-slate-500">{messageTypeLabel(c.messageType)}</span>
                    <span className="text-slate-500">
                      {new Date(c.sentAt ?? c.createdAt).toLocaleString()}
                    </span>
                    <span className="font-medium">{statusLabel({ status: c.status })}</span>
                    {messageShowsAmount(c.messageType) && (
                      <span className="text-slate-500">{formatCurrency(c.amountDue)}</span>
                    )}
                    {c.errorMessage && (
                      <span className="text-red-600">Failure: {c.errorMessage}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Payment Received / Closed"
            description="Paid before the message went out — no action needed."
            count={data.counts.closed}
          >
            {data.closed.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing closed.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-white text-sm">
                {data.closed.map((c: BoardCard) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <Link
                      to="/clients/$id"
                      params={{ id: c.clientId }}
                      className="font-medium hover:underline"
                    >
                      {c.clientName}
                    </Link>
                    <span className="text-slate-500">{messageTypeLabel(c.messageType)}</span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Payment Received — No Message Needed
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </AppShell>
  );
}

function blockedActionLabel(warnings: string[]): string {
  const joined = warnings.join(" ").toLowerCase();
  if (joined.includes("consent not recorded")) return "Record consent on the client record";
  if (joined.includes("package info")) return "Fix package info";
  if (joined.includes("payment review")) return "Review payment";
  return "Open client";
}
