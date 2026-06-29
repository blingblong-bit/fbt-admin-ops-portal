import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Import · FIT Beyond Therapy Admin" }] }),
  component: ImportPage,
});

function ImportPage() {
  const [text, setText] = useState("");
  const { data: previous = [], refetch } = useQuery({
    queryKey: ["imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!text.trim()) throw new Error("Paste something first");
      const { error } = await supabase.from("imports").insert({ raw_text: text });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved. Parser coming in v2.");
      setText("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Import Clients</h1>
      <p className="mb-6 text-sm text-slate-500">
        Paste raw text from Apple Notes below. For now we just store it — the parser arrives in v2.
      </p>

      <Card className="mb-6 max-w-4xl">
        <CardHeader>
          <CardTitle>Paste Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your Apple Notes content here…"
            className="font-mono text-sm"
          />
          <div className="mt-4 flex justify-end">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save Import"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Previous Imports</CardTitle>
        </CardHeader>
        <CardContent>
          {previous.length === 0 ? (
            <p className="text-sm text-slate-500">No imports yet.</p>
          ) : (
            <ul className="divide-y">
              {previous.map((i) => (
                <li key={i.id} className="py-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{new Date(i.created_at).toLocaleString()}</span>
                    <span>{i.parsed ? "Parsed" : "Unparsed"}</span>
                  </div>
                  <pre className="mt-1 max-h-32 overflow-hidden whitespace-pre-wrap text-xs text-slate-700">
                    {i.raw_text.slice(0, 300)}
                    {i.raw_text.length > 300 ? "…" : ""}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
