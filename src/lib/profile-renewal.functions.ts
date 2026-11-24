// Profile "Upcoming renewal": read-only selection for one client, same Square
// booking index and override application as Payment Due. Writes nothing.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectProfileRenewal, type ProfileRenewal } from "./upcoming-first-visit";
import type { CurrentPackage } from "./profile-renewal";

export const getProfileRenewal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("clientId required");
    return { clientId: d.clientId };
  })
  .handler(async ({ data, context }): Promise<{ error: string | null; renewal: ProfileRenewal | null; current?: CurrentPackage }> => {
    const { supabase } = context as { supabase: any };
    const { data: row, error } = await supabase.from("clients").select("*").eq("id", data.clientId).maybeSingle();
    if (error) throw error;
    if (!row) return { error: "Client not found", renewal: null };
    const { data: ovr, error: oe } = await supabase.from("package_overrides").select("*").eq("client_id", data.clientId).is("cleared_at", null);
    if (oe) throw oe;
    const { applyOverridesToRows } = await import("./package-override");
    const [c] = applyOverridesToRows([row], ovr ?? []);
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    const current: CurrentPackage = { totalVisits: num(c.package_total_visits), price: num(c.package_price), packageName: c.package_name ?? null };
    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return { error: "Square unavailable", renewal: null, current };
    const { loadSquareBookingIndex } = await import("./effective-visit-state.server");
    const index = await loadSquareBookingIndex(token, 180, 90);
    if (index.error) return { error: "Square unavailable", renewal: null, current };
    const bookings = c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : [];
    return { error: null, renewal: selectProfileRenewal(c, bookings as never, index.nowIso), current };
  });
