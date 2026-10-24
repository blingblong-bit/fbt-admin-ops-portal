import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SetupRow } from "@/lib/package-setup";

export type PackageSetupResult = { rows: (SetupRow & { name: string })[]; error: string | null };

/** Read-only list of assessment clients awaiting a first package. Writes nothing. */
export const getPackageSetupList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PackageSetupResult> => {
    const sb = context.supabase;
    const { classifySetup, sortSetupRows } = await import("@/lib/package-setup");
    const { applyOverrides } = await import("@/lib/package-override");

    const { data: clients, error } = await sb
      .from("clients")
      .select("id, first_name, last_name, status, deleted_at, payment_model, package_total_visits, package_name, square_customer_id")
      .is("deleted_at", null)
      .neq("status", "archived")
      .neq("payment_model", "pay_per_visit")
      .or("package_total_visits.is.null,package_total_visits.eq.0");
    if (error) return { rows: [], error: error.message };

    const { data: acts, error: aErr } = await sb
      .from("client_activities")
      .select("client_id, activity_type, created_at")
      .in("activity_type", ["package_review_dismissed", "package_review_redo"])
      .order("created_at", { ascending: true });
    if (aErr) return { rows: [], error: aErr.message };
    const latest = new Map<string, string>();
    for (const a of acts ?? []) latest.set(a.client_id, a.activity_type);

    const { data: ovs } = await sb.from("package_overrides").select("*").is("cleared_at", null);

    let index: { nowIso: string; byCustomer: Map<string, { start_at?: string | null; status?: string | null; seller_note?: string | null; customer_note?: string | null }[]>; error: string | null } =
      { nowIso: new Date().toISOString(), byCustomer: new Map(), error: null };
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) index.error = "Square isn't connected, so appointments couldn't be read";
    else {
      const { loadSquareBookingIndex } = await import("@/lib/effective-visit-state.server");
      index = await loadSquareBookingIndex(token, 180, 90);
    }

    const rows = [];
    for (const c of clients ?? []) {
      const mine = (ovs ?? []).filter((o) => o.client_id === c.id) as never[];
      const eff = mine.length ? applyOverrides(c, mine) : c;
      const bookings = (c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [])
        .filter((b) => b.start_at)
        .map((b) => ({ ...b, start_at: b.start_at! }));
      const r = classifySetup(eff, latest.get(c.id) === "package_review_dismissed", bookings, index.nowIso);
      if (r) rows.push({ ...r, name: `${c.first_name} ${c.last_name}`.trim() });
    }
    return { rows: sortSetupRows(rows) as PackageSetupResult["rows"], error: index.error };
  });
