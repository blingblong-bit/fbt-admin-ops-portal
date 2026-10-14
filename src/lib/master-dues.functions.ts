// Payment Due = Master Dues. The dashboard tile and the /payment-due page both
// read this one function so their totals can never drift. Read-only.
import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeMasterDues, timingFromUncovered, type RenewalTiming } from "./master-dues";
import { drivingCounts, forecastRenewal } from "./effective-visit-state";

type Result =
  | { error: string; computed_at: string; data: null }
  | { error: null; computed_at: string; data: ReturnType<typeof computeMasterDues> };

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
      let t: RenewalTiming;
      if (st.suppressed) t = { kind: "unknown", ymd: null, reason: "Square position unreadable" };
      else if (d.nextPackageStart && d.nextPackageStart <= nowIso) t = { kind: "started", ymd: chi(d.nextPackageStart), reason: "Square shows the next package has started" };
      else if (f.firstUncoveredStart) t = timingFromUncovered(f.firstUncoveredStart, nowIso, chi(f.firstUncoveredStart));
      else t = { kind: "no_start", ymd: null, reason: "No uncovered appointment booked" };
      renewalTiming.set(c.id, t);
    }

    const data = computeMasterDues(clients, { todayYmd: chi(nowIso), nextAppointmentYmd, renewalTiming, squareNumberedPackage });
    return { error: null, computed_at: nowIso, data };
  });

export const masterDuesQuery = (fn: () => Promise<Result>) =>
  queryOptions({ queryKey: ["master-dues"], queryFn: fn, staleTime: 60_000 });
