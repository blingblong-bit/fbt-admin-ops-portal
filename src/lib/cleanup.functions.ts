import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getScheduledClientIds } from "@/lib/schedule.functions";

export type ArchiveInactiveResult = {
  evaluated: number;
  archived: number;
  skipped_scheduled: number;
  skipped_manual_active: number;
  skipped_has_balance: number;
  skipped_has_visits: number;
  skipped_recent_activity: number;
};

/**
 * Bulk-archive Square-imported clients that are clearly inactive:
 *   - not deleted, not already archived
 *   - no future Square booking (next 30 days)
 *   - no visits remaining
 *   - no amount owed
 *   - not manually pinned active
 *   - no activity update in the last 30 days
 *   - linked to a Square customer (imports)
 */
export const archiveInactiveSquareImports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ArchiveInactiveResult> => {
    const scheduled = await getScheduledClientIds({ data: { days: 30 } });
    const scheduledSet = new Set<string>(scheduled.client_ids);

    // Paginate in 1000-row chunks so every candidate past the default
    // PostgREST 1000-row cap is evaluated.
    type CleanupRow = {
      id: string;
      status: string | null;
      manual_active: boolean | null;
      package_total_visits: number | null;
      visits_used: number | null;
      package_price: number | string | null;
      amount_paid: number | string | null;
      square_customer_id: string | null;
      updated_at: string;
      deleted_at: string | null;
    };
    const rows: CleanupRow[] = [];
    {
      const pageSize = 1000;
      let from = 0;
      for (let i = 0; i < 100; i++) {
        const { data: page, error } = await context.supabase
          .from("clients")
          .select(
            "id, status, manual_active, package_total_visits, visits_used, package_price, amount_paid, square_customer_id, updated_at, deleted_at",
          )
          .is("deleted_at", null)
          .not("square_customer_id", "is", null)
          .neq("status", "archived")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = (page ?? []) as CleanupRow[];
        if (chunk.length === 0) break;
        rows.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
      }
    }


    const out: ArchiveInactiveResult = {
      evaluated: rows?.length ?? 0,
      archived: 0,
      skipped_scheduled: 0,
      skipped_manual_active: 0,
      skipped_has_balance: 0,
      skipped_has_visits: 0,
      skipped_recent_activity: 0,
    };

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const toArchive: string[] = [];

    for (const r of rows ?? []) {
      const c = r as unknown as {
        id: string;
        manual_active: boolean | null;
        package_total_visits: number | null;
        visits_used: number | null;
        package_price: number | string | null;
        amount_paid: number | string | null;
        updated_at: string;
      };
      if (c.manual_active) {
        out.skipped_manual_active++;
        continue;
      }
      if (scheduledSet.has(c.id)) {
        out.skipped_scheduled++;
        continue;
      }
      const total = Number(c.package_total_visits ?? 0);
      const used = c.visits_used == null ? 0 : Number(c.visits_used);
      const visitsLeft = Math.max(0, total - used);
      if (visitsLeft > 0) {
        out.skipped_has_visits++;
        continue;
      }
      const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
      if (owed > 0) {
        out.skipped_has_balance++;
        continue;
      }
      if (new Date(c.updated_at).getTime() > cutoff) {
        out.skipped_recent_activity++;
        continue;
      }
      toArchive.push(c.id);
    }

    if (toArchive.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: uErr } = await supabaseAdmin
        .from("clients")
        .update({ status: "archived" })
        .in("id", toArchive);
      if (uErr) throw uErr;
      const activities = toArchive.map((id) => ({
        client_id: id,
        activity_type: "archived",
        description: "Archived as inactive Square import (no booking, no balance, no visits remaining)",
      }));
      await supabaseAdmin.from("client_activities").insert(activities);
      try {
        await supabaseAdmin.from("square_sync_log").insert({
          event_type: "cleanup.archive_inactive",
          status: "success",
          action: "bulk_archive",
          message: `Archived ${toArchive.length} inactive Square imports`,
        });
      } catch {
        // ignore
      }
      out.archived = toArchive.length;
    }

    return out;
  });
