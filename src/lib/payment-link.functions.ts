// Square checkout links — SANDBOX ONLY, test-fixture clients ONLY (proof stage).
// Amount = Master Dues effective total for the fixture (overrides applied).
// Nothing is sent; no production link is created here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeMasterDues } from "./master-dues";
import { obligationFor, decideLink, idempotencyKeyFor } from "./payment-link";
import { applyOverridesToRows } from "./package-override";

const SANDBOX = "https://connect.squareupsandbox.com";
const chi = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function assertAdmin(supabase: any, userId: string) {
  const [a, s] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
  ]);
  if (!a.data && !s.data) throw new Error("Only admins can use sandbox payment links.");
}

/** Effective (override-applied) obligation for one client row. Exported for tests. */
export function fixtureObligation(raw: any, overrides: any[], todayYmd: string) {
  const eff: any = applyOverridesToRows([raw], overrides)[0];
  const dues = computeMasterDues([eff], { todayYmd, nextAppointmentYmd: new Map(), renewalTiming: new Map() });
  const row = dues.rows.find((r) => r.client_id === raw.id);
  return { eff, ob: obligationFor(row, { currentStart: eff.package_start_date ?? null, preparedStart: eff.pending_renewal_start_date ?? null }) };
}

export const createSandboxPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertAdmin(supabase, userId);
    const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_SANDBOX_LOCATION_ID;
    if (!token || !locationId) return { error: "Square sandbox credentials are not set up." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c, error: ce } = await supabaseAdmin.from("clients").select("*").eq("id", data.clientId).maybeSingle();
    if (ce) throw ce;
    if (!c || !(c as any).is_test_fixture) return { error: "Sandbox links are only allowed for test-fixture clients." };
    const { data: ovr } = await supabaseAdmin.from("package_overrides").select("*").eq("client_id", c.id).is("cleared_at", null);
    const { ob } = fixtureObligation(c, ovr ?? [], chi(new Date()));
    if (!ob.ok) return { error: `No link: ${ob.reason}` };

    const { data: rows } = await supabaseAdmin.from("square_payment_links")
      .select("id, obligation_key, status, url, generation").eq("client_id", c.id).eq("environment", "sandbox");
    const active = (rows ?? []).find((r: any) => r.status === "active" && r.url) ?? null;
    const d = decideLink(active, ob);
    if (d.action === "reuse") return { error: null, url: d.link.url, amountCents: ob.amountCents, reused: true };

    // Paid/held/superseded rows are never reactivated; each new link is a new generation.
    const generation = (rows ?? []).filter((r: any) => r.url).length;
    const idem = idempotencyKeyFor(ob.obligationKey, "sandbox", generation);
    const res = await fetch(`${SANDBOX}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": "2024-10-17" },
      body: JSON.stringify({
        idempotency_key: idem,
        order: {
          location_id: locationId,
          reference_id: c.id.slice(0, 40),
          line_items: [{ name: "FIT Beyond Therapy package balance (TEST)", quantity: "1", base_price_money: { amount: ob.amountCents, currency: "USD" } }],
        },
      }),
    });
    if (!res.ok) return { error: `Square sandbox error [${res.status}]: ${await res.text()}` };
    const pl = (await res.json()).payment_link;
    if (d.supersede) await supabaseAdmin.from("square_payment_links").update({ status: "superseded" }).eq("id", d.supersede);
    // Clear any incomplete (no URL) row left by an earlier failed attempt for this generation.
    await supabaseAdmin.from("square_payment_links").delete().eq("client_id", c.id).eq("environment", "sandbox").is("url", null);
    const { error } = await supabaseAdmin.from("square_payment_links").insert({
      client_id: c.id, obligation_key: ob.obligationKey, amount_cents: ob.amountCents, environment: "sandbox", generation,
      idempotency_key: idem, square_order_id: pl.order_id, square_link_id: pl.id, url: pl.url, status: "active", created_by: userId,
    });
    if (error) throw error;
    return { error: null, url: pl.url as string, amountCents: ob.amountCents, reused: false };
  });

/** Disposable ZZTEST fixture: $375 package, 8 visits, given prepaid amount. */
export const createSandboxFixture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ prepaid: z.number().min(0).max(375) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c, error } = await supabaseAdmin.from("clients").insert({
      first_name: "ZZTEST", last_name: "SandboxLink", status: "active", is_test_fixture: true,
      package_price: 375, amount_paid: data.prepaid, package_total_visits: 8, visits_used: 0, package_start_date: chi(new Date()),
    } as never).select("id").single();
    if (error) throw error;
    return { clientId: c.id as string };
  });

/** Removes every test fixture with its links and activity rows. */
export const deleteSandboxFixtures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fx } = await supabaseAdmin.from("clients").select("id").eq("is_test_fixture", true);
    const ids = (fx ?? []).map((r: any) => r.id);
    if (!ids.length) return { deleted: 0 };
    await supabaseAdmin.from("square_payment_links").delete().in("client_id", ids);
    await supabaseAdmin.from("client_activities").delete().in("client_id", ids);
    const { error } = await supabaseAdmin.from("clients").delete().in("id", ids).eq("is_test_fixture", true);
    if (error) throw error;
    return { deleted: ids.length };
  });
