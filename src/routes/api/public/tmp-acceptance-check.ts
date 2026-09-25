// TEMPORARY read-only acceptance check. Deleted right after use. Writes nothing.
import { createFileRoute } from "@tanstack/react-router";

const KEY = "acc-7f3b9d21-c4e8-4a6f-9b0e-readonly";
const APPROVED = ["Zach Wolberg", "Janet Cunningham", "Analeigh Spain", "Deby Barnett", "Ben Quick", "Beau Watt", "Ginger Ennis", "Madelyn Shockley"];

export const Route = createFileRoute("/api/public/tmp-acceptance-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (request.headers.get("x-acc-key") !== KEY) return new Response("no", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadSquareBookingIndex, effectiveStateFor, upcomingStarts } = await import("@/lib/effective-visit-state.server");
        const { drivingCounts, forecastRenewal } = await import("@/lib/effective-visit-state");
        const { decideRenewalText } = await import("@/lib/renewal-text-eligibility");
        const index = await loadSquareBookingIndex(process.env["SQUARE_PRODUCTION_ACCESS_TOKEN"]!);
        if (index.error) return Response.json({ error: index.error });
        const { data } = await supabaseAdmin.from("clients")
          .select("id, first_name, last_name, phone, square_customer_id, visits_used, package_total_visits, package_price, amount_paid, payment_model, status, sms_consent_at, sms_opted_out_at, pending_renewal_start_date")
          .is("deleted_at", null).eq("status", "active").not("square_customer_id", "is", null);
        const imp = { checked: 0, old_square: 0, old_hub: 0, old_review_required: 0, new_square: 0, new_hub: 0, new_square_needs_review: 0, new_hub_needs_review: 0, new_held: 0,
          newly_driven_by_square: 0, decision_changes_from_unheld: 0, text_old_qualify: 0, text_new_qualify: 0, text_newly_qualify: 0, text_stop_qualify: 0, text_held_old: 0, text_held_new: 0 };
        const changed: unknown[] = [];
        const spot: unknown[] = [];
        for (const c of (data ?? []) as any[]) {
          if (c.payment_model === "pay_per_visit") continue;
          imp.checked++;
          const s = effectiveStateFor(index, c);
          const starts = upcomingStarts(index, c.square_customer_id);
          const oldHeld = s.issues.length > 0;
          const oldSource = oldHeld ? "review_required" : s.source;
          if (oldHeld) imp.old_review_required++; else if (s.source === "square") imp.old_square++; else imp.old_hub++;
          if (s.source === "square") { imp.new_square++; if (s.reviewStatus === "needs_review") imp.new_square_needs_review++; }
          else { imp.new_hub++; if (s.reviewStatus === "needs_review") imp.new_hub_needs_review++; }
          if (!s.automationUsable) imp.new_held++;
          if (oldHeld && s.source === "square") {
            imp.newly_driven_by_square++;
            const d = drivingCounts(s);
            const a = forecastRenewal({ upcomingStarts: starts, visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
            const h = forecastRenewal({ upcomingStarts: starts, visitsUsed: Number(c.visits_used ?? 0), totalVisits: Number(c.package_total_visits ?? 0), nextPackageStart: null });
            if (a.firstUncoveredStart?.slice(0, 10) !== h.firstUncoveredStart?.slice(0, 10)) {
              imp.decision_changes_from_unheld++;
              changed.push({ name: `${c.first_name} ${c.last_name}`, hub: `${c.visits_used}/${c.package_total_visits}`, square: `${s.visitsUsed}/${s.totalVisits}`, renewal_hub: h.firstUncoveredStart?.slice(0, 10) ?? null, renewal_square: a.firstUncoveredStart?.slice(0, 10) ?? null, flag: s.issues.map((i) => i.kind).join(",") });
            }
          }
          const newD = decideRenewalText(c, s, starts, false);
          const oldD = oldHeld ? { eligible: false } : newD;
          if (oldHeld) imp.text_held_old++;
          if (newD.suppressed) imp.text_held_new++;
          if (oldD.eligible) imp.text_old_qualify++;
          if (newD.eligible) imp.text_new_qualify++;
          if (!oldD.eligible && newD.eligible) imp.text_newly_qualify++;
          if (oldD.eligible && !newD.eligible) imp.text_stop_qualify++;
          const name = `${c.first_name} ${c.last_name}`;
          if (APPROVED.includes(name)) {
            const d = drivingCounts(s);
            const f = forecastRenewal({ upcomingStarts: starts, visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
            spot.push({ name, old: oldSource, source: s.source, review: s.reviewStatus, usable: s.automationUsable, hub: `${c.visits_used}/${c.package_total_visits}`, position: `${d.used}/${d.total}`, next_start: (s.nextPackageStart ?? f.firstUncoveredStart)?.slice(0, 10) ?? null, needs_renewal: f.needsRenewal, text: newD.eligible, text_reason: newD.reason, reason: s.reason });
          }
        }
        return Response.json({ imp, changed, spot, auto_text: process.env["RENEWAL_AUTO_TEXT_ENABLED"] === "true", sms: process.env["SMS_DUES_SENDING_ENABLED"] === "true" });
      },
    },
  },
});
