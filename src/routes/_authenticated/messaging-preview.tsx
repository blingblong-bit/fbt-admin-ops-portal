import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/components/ui/sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/require-admin";
import { getMessagingFlag, listDuesMessages, generateDuesPreviews } from "@/lib/dues-messaging.functions";
import { DuesMessageList, SendingDisabledBanner } from "@/components/DuesMessageList";

export const Route = createFileRoute("/_authenticated/messaging-preview")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [
      { title: "Messaging Preview · FIT Beyond Therapy Admin" },
      {
        name: "description",
        content: "Review drafted dues text messages before any sending is enabled.",
      },
      { property: "og:title", content: "Messaging Preview · FIT Beyond Therapy Admin" },
      {
        property: "og:description",
        content: "Review drafted dues text messages before any sending is enabled.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagingPreviewPage,
});

function MessagingPreviewPage() {
  const qc = useQueryClient();
  const flagFn = useServerFn(getMessagingFlag);
  const listFn = useServerFn(listDuesMessages);
  const genFn = useServerFn(generateDuesPreviews);

  const flag = useQuery({ queryKey: ["messaging-flag"], queryFn: () => flagFn() });
  const messages = useQuery({
    queryKey: ["dues-messages", "all"],
    queryFn: () => listFn({ data: {} }),
  });

  const generate = useMutation({
    mutationFn: () => genFn(),
    onSuccess: (r) => {
      toast.success(
        `Previews refreshed — ${r.created} new, ${r.updated} updated, ${r.closed} closed. Nothing sent.`,
      );
      qc.invalidateQueries({ queryKey: ["dues-messages"] });
      qc.invalidateQueries({ queryKey: ["dues-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Messaging Preview</h1>
      <p className="mb-4 text-sm text-slate-500">
        Every drafted dues message, newest first. Nothing is sent.
      </p>
      <SendingDisabledBanner enabled={flag.data?.sendingEnabled ?? false} />

      <div className="mb-4">
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? "Refreshing…" : "Generate / Refresh Preview"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Drafts</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <DuesMessageList messages={messages.data?.messages ?? []} />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
