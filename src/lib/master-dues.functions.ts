// Payment Due = Master Dues. The dashboard tile and the /payment-due page both
// read this one function so their totals can never drift. Read-only.
import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeMasterDues, renewalTimingFor, type RenewalTiming, liveNumbered } from "./master-dues";
import { drivingCounts, forecastRenewal } from "./effective-visit-state";
import { simulateBilling, type SimResult } from "./billing-sim";

type Result =
  | { error: string; computed_at: string; data: null }
  | { error: null; computed_at: string; data: ReturnType<typeof computeMasterDues> & { appointments: Record<string, string[]> } };

const chi = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const NUMBERED = /\b\d+\s*(of|\/)\s*\d+\b/i;

export const getMasterDues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Result> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const [a, s] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
    ]);
    if (!a.data && !s.data) throw new Error("Only admins can view Payment Due.");

    const now = new Date().toISOString();
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return { error: "Square unavailable", computed_at: now, data: null };

    const clients: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("clients").select("*").is("deleted_at", null).neq("status", "archived").range(from, from + 999);
      if (error) throw error;
      clients.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const { loadSquareBookingIndex, effectiveStateFor, upcomingStarts } = await import("./effective-visit-state.server");
    const index = await loadSquareBookingIndex(token, 180, 90);
    if (index.error) return { error: "Square unavailable", computed_at: now, data: null };
    const nowIso = index.nowIso;

    const renewalTiming = new Map<string, RenewalTiming>();
    const nextAppointmentYmd = new Map<string, string>();
    const squareNumberedPackage = new Set<string>();
    for (const c of clients) {
      const st = effectiveStateFor(index, c);
      const d = drivingCounts(st);
      const ups = upcomingStarts(index, c.square_customer_id);
      if (ups[0]) nextAppointmentYmd.set(c.id, chi(ups[0]));
      const bks = c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [];
      if (bks.some((b) => NUMBERED.test(b.seller_note ?? "") || NUMBERED.test(b.customer_note ?? ""))) squareNumberedPackage.add(c.id);
      const f = forecastRenewal({ upcomingStarts: ups, visitsUsed: d.used, totalVisits: d.total, nextPackageStart: d.nextPackageStart });
      const t = renewalTimingFor(c, { suppressed: st.suppressed, ...d, firstUncoveredStart: f.firstUncoveredStart }, nowIso, {
        live: liveNumbered(bks),
        preparedAtIso: c.pending_renewal_created_at ? new Date(c.pending_renewal_created_at).toISOString() : null,
      });
      renewalTiming.set(c.id, t);
    }

    // PPV / weekly billing: obligations from Square appointments since the
    // billing effective date; payments only from that date, clearly attributable.
    const billing = new Map<string, SimResult>();
    const billed = clients.filter((c) => c.billing_type === "pay_per_visit" || c.billing_type === "weekly");
    if (billed.length) {
      const { data: pays, error: pe } = await supabase
        .from("square_payments").select("square_payment_id, client_id, amount_cents, status, created_at")
        .in("client_id", billed.map((c) => c.id)).eq("status", "COMPLETED");
      if (pe) throw pe;
      for (const c of billed) {
        const rate = c.billing_type === "weekly" ? c.weekly_rate : c.per_visit_rate;
        const eff: string | null = c.billing_effective_date ?? null;
        const bks = c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [];
        billing.set(c.id, simulateBilling({
          type: c.billing_type,
          rate: eff && c.square_customer_id ? rate : null,
          appointments: bks.filter((b) => b.start_at).map((b) => ({ id: b.id, start_iso: b.start_at!, ymd: chi(b.start_at!), status: b.status })),
          payments: (pays ?? []).filter((p: any) => p.client_id === c.id).map((p: any) => ({ id: p.square_payment_id, at_iso: new Date(p.created_at).toISOString(), amount: Number(p.amount_cents) / 100 })),
          todayYmd: chi(nowIso),
          nowIso,
          windowStartYmd: eff,
        }));
      }
    }

    const data = computeMasterDues(clients, { todayYmd: chi(nowIso), nextAppointmentYmd, renewalTiming, squareNumberedPackage, billing });
    // Weekly Dues: non-cancelled appointment starts from 2 weeks back to 2 weeks ahead (display only).
    const lo = Date.parse(nowIso) - 21 * 864e5, hi = Date.parse(nowIso) + 21 * 864e5;
    const appointments: Record<string, string[]> = {};
    for (const r of data.rows) {
      const c = clients.find((x) => x.id === r.client_id);
      const bks = c?.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [];
      appointments[r.client_id] = bks
        .filter((b) => b.start_at && !/CANCEL|DECLINE|NO_SHOW/i.test(b.status ?? ""))
        .map((b) => b.start_at!)
        .filter((s) => { const t = Date.parse(s); return t >= lo && t <= hi; });
    }
    return { error: null, computed_at: nowIso, data: { ...data, appointments } };
  });

export const masterDuesQuery = (fn: () => Promise<Result>) =>
  queryOptions({ queryKey: ["master-dues"], queryFn: fn, staleTime: 60_000 });
