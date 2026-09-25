import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReviewStatus, UpcomingVisit, VisitSource } from "@/lib/effective-visit-state";

type Ctx = { supabase: any; userId: string };

export type AutomationCard = {
  client_id: string;
  name: string;
  source: VisitSource;
  review_status: ReviewStatus;
  automation_usable: boolean;
  reason: string;
  hub: string;
  square: string | null;
  effective: string;
  recent: UpcomingVisit[];
  upcoming: UpcomingVisit[];
  next_package_start: string | null;
  renewal_state: string;
  amount_note: string | null;
  actions: string[];
};

export type AutomationImpact = {
  checked: number;
  square: number;
  hub_fallback: number;
  needs_review: number;
  square_needs_review: number;
  count_differs: number;
  renewal_date_moves: number;
  payment_week_moves: number;
  dues_changes: number;
  dues_newly_gain: number;
  dues_removed_or_moved: number;
  held_for_review: number;
};

export type VisitAutomationReview = {
  generated_at: string;
  impact: AutomationImpact;
  cards: AutomationCard[];
  error: string | null;
};

/** Read-only: compares stored Hub behaviour with Square-derived behaviour. Writes nothing. */
export const getVisitAutomationReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VisitAutomationReview> => {
    const ctx = context as unknown as Ctx;
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" }),
    ]);
    if (!isAdmin && !isSuper) throw new Error("Forbidden — admin access required");

    const impact: AutomationImpact = {
      checked: 0, square: 0, hub_fallback: 0, needs_review: 0, square_needs_review: 0, count_differs: 0,
      renewal_date_moves: 0, payment_week_moves: 0, dues_changes: 0,
      dues_newly_gain: 0, dues_removed_or_moved: 0, held_for_review: 0,
    };
    const nowIso = new Date().toISOString();
    const empty = (error: string | null): VisitAutomationReview => ({ generated_at: nowIso, impact, cards: [], error });

    const clients: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.supabase
        .from("clients")
        .select("id, first_name, last_name, square_customer_id, visits_used, package_total_visits, payment_model, pending_renewal_start_date, pending_renewal_price, pending_renewal_paid, package_price, next_package_price")
        .eq("status", "active")
        .is("deleted_at", null)
        .not("square_customer_id", "is", null)
        .order("created_at")
        .range(from, from + 999);
      if (error) return empty(error.message);
      clients.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return empty("Square access token is not configured");

    const { loadSquareBookingIndex, effectiveStateFor, upcomingStarts } = await import("@/lib/effective-visit-state.server");
    const { forecastRenewal, drivingCounts } = await import("@/lib/effective-visit-state");
    const { ymdInTz, workWeekStartFromYmd, addDaysYmd } = await import("@/lib/schedule.functions");

    const index = await loadSquareBookingIndex(token, 180, 90);
    if (index.error) return empty(index.error);

    const todayYmd = ymdInTz(new Date());
    const weekStart = workWeekStartFromYmd(todayYmd);
    const nextWeek = addDaysYmd(weekStart, 7);
    const bucket = (ymd: string | null) => {
      if (!ymd) return "none";
      const w = workWeekStartFromYmd(ymd);
      return w === weekStart ? "this" : w === nextWeek ? "next" : "later";
    };
    const money = (n: number) => `$${n.toFixed(2)}`;

    const cards: AutomationCard[] = [];
    for (const c of clients) {
      if (c.payment_model === "pay_per_visit") continue;
      impact.checked++;
      const state = effectiveStateFor(index, c);
      impact[state.source]++;
      if (state.reviewStatus === "needs_review") { impact.needs_review++; if (state.source === "square") impact.square_needs_review++; }
      const starts = upcomingStarts(index, c.square_customer_id);
      const hubUsed = Number(c.visits_used ?? 0);
      const hubTotal = Number(c.package_total_visits ?? 0);

      // Today's behaviour (stored Hub count) vs Square-derived behaviour.
      const before = forecastRenewal({ upcomingStarts: starts, visitsUsed: hubUsed, totalVisits: hubTotal, nextPackageStart: null });
      const drive = drivingCounts(state);
      const after = forecastRenewal({ upcomingStarts: starts, visitsUsed: drive.used, totalVisits: drive.total, nextPackageStart: drive.nextPackageStart });

      const beforeYmd = before.needsRenewal && before.firstUncoveredStart ? ymdInTz(new Date(before.firstUncoveredStart)) : null;
      const afterYmd = after.needsRenewal && after.firstUncoveredStart ? ymdInTz(new Date(after.firstUncoveredStart)) : null;
      const pending: string | null = c.pending_renewal_start_date ?? null;
      // Prepared start date drives the week bucket when present (unchanged rule).
      const beforeBucket = bucket(pending ?? beforeYmd);
      const afterBucket = bucket(pending ?? afterYmd);

      const actions: string[] = [];
      const countDiffers = state.source === "square" && (state.visitsUsed !== hubUsed || state.totalVisits !== hubTotal);
      if (countDiffers) { impact.count_differs++; actions.push(`Visit count now ${state.visitsUsed}/${state.totalVisits} from Square (Hub stored ${hubUsed}/${hubTotal}, unchanged)`); }
      if (state.source === "square" && state.visitsUsed >= state.totalVisits) actions.push("Package appears complete");
      if (state.nextPackageStart) actions.push(`Next package start detected: ${ymdInTz(new Date(state.nextPackageStart))}`);

      const renewalMoved = beforeYmd !== afterYmd;
      if (renewalMoved) {
        impact.renewal_date_moves++;
        actions.push(!beforeYmd ? `Needs Renewal (from ${afterYmd})` : !afterYmd ? "No longer needs renewal yet" : `Renewal date ${beforeYmd} → ${afterYmd}`);
      }
      const weekMoved = beforeBucket !== afterBucket && (beforeBucket !== "later" || afterBucket !== "later") && !(beforeBucket === "none" && afterBucket === "later") && !(beforeBucket === "later" && afterBucket === "none");
      if (weekMoved) { impact.payment_week_moves++; actions.push(`Payment Due week: ${beforeBucket} → ${afterBucket}`); }

      // Dues-text consequence: a renewal landing in This/Next Week without a
      // prepared package is a new renewal-dues consequence; one leaving those
      // weeks removes or moves an existing one.
      const inWindow = (b: string) => b === "this" || b === "next";
      if (!pending && inWindow(bucket(beforeYmd)) !== inWindow(bucket(afterYmd))) {
        impact.dues_changes++;
        if (inWindow(bucket(afterYmd))) { impact.dues_newly_gain++; actions.push("Would newly need a renewal dues text"); }
        else { impact.dues_removed_or_moved++; actions.push("Renewal dues text no longer due this/next week"); }
      } else if (!pending && inWindow(bucket(afterYmd)) && bucket(beforeYmd) !== bucket(afterYmd)) {
        impact.dues_changes++; impact.dues_removed_or_moved++; actions.push("Renewal dues text moves week");
      }

      if (pending && state.nextPackageStart) {
        const sq = ymdInTz(new Date(state.nextPackageStart));
        if (sq !== pending) actions.push(`Prepared renewal ${pending} differs from Square ${sq}`);
      }

      if (!state.automationUsable) {
        impact.held_for_review++;
        actions.unshift("Held — current Square position unreadable; keeping current Hub behaviour");
      } else if (state.reviewStatus === "needs_review") {
        actions.push("Needs review — Square still drives");
      }

      if (actions.length === 0) continue;
      const nextPrice = Number(c.pending_renewal_price ?? c.next_package_price ?? c.package_price ?? 0);
      cards.push({
        client_id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        source: state.source,
        review_status: state.reviewStatus,
        automation_usable: state.automationUsable,
        reason: state.reason,
        hub: `${hubUsed}/${hubTotal}`,
        square: state.source === "square" ? `${state.visitsUsed}/${state.totalVisits}` : null,
        effective: `${drive.used}/${drive.total}`,
        recent: state.recent.slice(-4),
        upcoming: state.upcoming.slice(0, 5),
        next_package_start: state.nextPackageStart,
        renewal_state: pending ? `Prepared — starts ${pending}` : afterYmd ? `Needs renewal — ${afterYmd}` : "Not due yet",
        amount_note: (renewalMoved || weekMoved) && nextPrice > 0 ? `Next package ${money(nextPrice)}` : null,
        actions,
      });
    }
    const rank = (c: AutomationCard) => (!c.automation_usable ? 0 : c.review_status === "needs_review" ? 1 : c.source === "square" ? 2 : 3);
    cards.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { generated_at: nowIso, impact, cards, error: null };
  });
