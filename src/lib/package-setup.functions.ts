import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SetupRow } from "@/lib/package-setup";
import type { AssessmentReviewRow } from "@/lib/assessment-package-review";

export type PackageSetupResult = { rows: (SetupRow & { name: string })[]; review: AssessmentReviewRow[]; checked_at: string; error: string | null };

/** Read-only list of assessment clients awaiting a first package. Writes nothing. */
export const getPackageSetupList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PackageSetupResult> => {
    const sb = context.supabase;
    const { classifySetup, sortSetupRows } = await import("@/lib/package-setup");
    const { applyOverrides } = await import("@/lib/package-override");
    const { assessmentPackageReview } = await import("@/lib/assessment-package-review");
    const checked_at = new Date().toISOString();
    const failed = (error: string): PackageSetupResult => ({ rows: [], review: [], checked_at, error });

    const clients = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("clients").select("*")
        .is("deleted_at", null).neq("status", "archived").eq("is_test_fixture", false).range(from, from + 999);
      if (error) return failed("Client records couldn't be read.");
      clients.push(...data ?? []);
      if (!data || data.length < 1000) break;
    }

    const { data: acts, error: aErr } = await sb
      .from("client_activities")
      .select("client_id, activity_type, created_at")
      .in("activity_type", ["package_review_dismissed", "package_review_redo"])
      .order("created_at", { ascending: true });
    if (aErr) return failed("Package review history couldn't be read.");
    const latest = new Map<string, string>();
    for (const a of acts ?? []) latest.set(a.client_id, a.activity_type);

    const { data: ovs, error: overrideError } = await sb.from("package_overrides").select("*").is("cleared_at", null);
    if (overrideError) return failed("Saved package corrections couldn't be read.");

    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return failed("Square isn't connected, so appointments couldn't be read.");
    const { loadSquareBookingIndex } = await import("@/lib/effective-visit-state.server");
    const index = await loadSquareBookingIndex(token, 180, 90);
    if (index.error) return failed("Square appointments couldn't be read.");
    const { loadSquareServices } = await import("@/lib/square-services.server");
    let services;
    try {
      services = await loadSquareServices(token, [...index.byCustomer.values()].flatMap((bs) => bs.flatMap((b) =>
        (b.appointment_segments ?? []).flatMap((s) => s.service_variation_id ? [s.service_variation_id] : []))));
    } catch { return failed("Square service types couldn't be read. Try Refresh."); }

    const rows = [];
    const review: AssessmentReviewRow[] = [];
    for (const c of clients ?? []) {
      const mine = (ovs ?? []).filter((o) => o.client_id === c.id) as never[];
      const eff = mine.length ? applyOverrides(c, mine) : c;
      const bookings = (c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [])
        .flatMap((b) => b.start_at ? [{ ...b, start_at: b.start_at }] : []);
      const evidence = assessmentPackageReview(eff, bookings, services, index.nowIso);
      if (evidence) review.push(evidence);
      const r = classifySetup(eff, latest.get(c.id) === "package_review_dismissed", bookings, index.nowIso);
      if (evidence) rows.push({
        client_id: c.id, name: evidence.name, state: "urgent" as const,
        last_visit_ymd: evidence.assessment_ymd, next_appointment_ymd: evidence.upcoming ? evidence.visit_ymd : null,
        future_count: bookings.filter((b) => b.start_at >= index.nowIso && /^(ACCEPTED|PENDING)$/.test(b.status ?? "")).length,
        dismissed: latest.get(c.id) === "package_review_dismissed", reason: evidence.reason,
      });
      else if (r) rows.push({ ...r, name: `${c.first_name} ${c.last_name}`.trim() });
    }
    review.sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || a.visit_ymd.localeCompare(b.visit_ymd) || a.name.localeCompare(b.name));
    return { rows: sortSetupRows(rows) as PackageSetupResult["rows"], review, checked_at: index.nowIso, error: null };
  });
