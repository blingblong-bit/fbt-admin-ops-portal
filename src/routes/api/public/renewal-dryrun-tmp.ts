// TEMPORARY read-only dry run — delete after use. No sends, no writes.
import { createFileRoute } from "@tanstack/react-router";
import { decideLegacy, decideRenewalText, campaignShouldAutoClear, legacyAutoClear } from "@/lib/renewal-text-eligibility";

export const Route = createFileRoute("/api/public/renewal-dryrun-tmp")({
  server: { handlers: { GET: async ({ request }) => {
    if (request.headers.get("x-dry-key") !== "fa1c0ad8b2c3903a49057eaa02eb97de") return new Response("no", { status: 401 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadSquareBookingIndex, effectiveStateFor } = await import("@/lib/effective-visit-state.server");
    const token = (process.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
    const count = async (t: "renewal_campaigns" | "renewal_messages") => (await supabaseAdmin.from(t).select("id", { count: "exact", head: true })).count;
    const before = { campaigns: await count("renewal_campaigns"), messages: await count("renewal_messages") };
    const index = await loadSquareBookingIndex(token);
    if (index.error) return Response.json({ error: index.error });
    const accepted = (id: string | null) => id ? (index.byCustomer.get(id) ?? []).filter((b) => b.start_at && b.start_at >= index.nowIso && (b.status ?? "").toUpperCase() === "ACCEPTED").map((b) => b.start_at!).sort() : [];
    const { data: clients } = await supabaseAdmin.from("clients")
      .select("id, first_name, last_name, phone, square_customer_id, package_total_visits, visits_used, package_price, amount_paid, package_start_date, sms_consent_at, sms_opted_out_at")
      .is("deleted_at", null).neq("payment_model", "pay_per_visit").gt("package_total_visits", 0);
    const { data: camps } = await supabaseAdmin.from("renewal_campaigns").select("id, client_id, status, package_start_date_snapshot, package_total_visits_snapshot, sends_count");
    const open = new Set((camps ?? []).filter((c) => c.status !== "renewed" && c.status !== "cancelled").map((c) => c.client_id + ":" + c.package_total_visits_snapshot));
    const r = { checked: 0, old_eligible: 0, new_eligible: 0, newly: [] as unknown[], stopped: [] as unknown[], review_suppressed: 0, review_would_have_qualified_old: 0, blocked_no_consent: 0, blocked_opted_out: 0, campaign_changes: [] as unknown[], open_campaigns: 0 };
    const byId = new Map((clients ?? []).map((c) => [c.id, c]));
    for (const c of clients ?? []) {
      r.checked++;
      const st = effectiveStateFor(index, c);
      const hasOpen = open.has(c.id + ":" + c.package_total_visits);
      const o = decideLegacy(c, accepted(c.square_customer_id), hasOpen);
      const n = decideRenewalText(c, st, accepted(c.square_customer_id), hasOpen);
      if (o.eligible) r.old_eligible++;
      if (n.eligible) r.new_eligible++;
      if (n.suppressed) { r.review_suppressed++; if (o.eligible) r.review_would_have_qualified_old++; }
      if (n.consentBlocked === "no_consent") r.blocked_no_consent++;
      if (n.consentBlocked === "opted_out") r.blocked_opted_out++;
      const row = { name: c.first_name + " " + c.last_name, old: o.basis + " → " + (o.eligible ? "eligible" : "not eligible (" + o.reason + ")"), new: n.basis + " → " + (n.eligible ? "eligible" : "not eligible (" + n.reason + ")") };
      if (!o.eligible && n.eligible) r.newly.push(row);
      if (o.eligible && !n.eligible) r.stopped.push(row);
    }
    for (const cp of (camps ?? []).filter((c) => ["active", "yes", "manual_review"].includes(c.status))) {
      r.open_campaigns++;
      const c = byId.get(cp.client_id); if (!c) continue;
      const st = effectiveStateFor(index, c);
      const oc = legacyAutoClear(c, cp); const nc = campaignShouldAutoClear(st, c, cp);
      const fuBlocked = cp.status === "active" && (!!c.sms_opted_out_at || !c.sms_consent_at || st.source === "review_required");
      if (oc !== nc || fuBlocked) r.campaign_changes.push({ name: c.first_name + " " + c.last_name, status: cp.status, old_autoclear: oc, new_autoclear: nc === null ? "held (review required)" : nc, followups_now_blocked: fuBlocked, basis: st.source });
    }
    const after = { campaigns: await count("renewal_campaigns"), messages: await count("renewal_messages") };
    return Response.json({ ...r, before, after });
  } } },
});
