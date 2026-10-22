// Watches the Square sync log; when a new background sync entry lands (webhook
// or scheduled tick), reloads open screens via the shared refresher. Cache
// refresh only — no billing or calculation logic lives here.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFor } from "@/lib/invalidation";
import { shouldRefreshForSync } from "@/lib/sync-watch";

const POLL_MS = 30_000;
const MIN_GAP_MS = 60_000; // never reload money screens more than once a minute

export function useSquareSyncWatcher() {
  const qc = useQueryClient();
  const seen = useRef<string | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await supabase
        .from("square_sync_log")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive || error || !data) return;
      const now = Date.now();
      const r = shouldRefreshForSync(seen.current, data.created_at, lastRefresh.current, now, MIN_GAP_MS);
      if (r.markSeen) seen.current = data.created_at;
      if (r.refresh) {
        lastRefresh.current = now;
        await invalidateFor(qc, "square-sync");
      }
    };
    void check();
    const id = setInterval(check, POLL_MS);
    const onVis = () => void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [qc]);
}
