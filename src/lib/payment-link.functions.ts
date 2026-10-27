// Square checkout link creation — SANDBOX ONLY in this proof stage. Amount is
// the effective Master Dues total for the client (overrides applied); nothing
// is sent to the client and no production link is ever created here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMasterDues } from "./master-dues.functions";
import { obligationFor, decideLink, idempotencyKeyFor } from "./payment-link";

const SANDBOX = "https://connect.squareupsandbox.com";

export const createSandboxPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const [a, s] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
    ]);
    if (!a.data && !s.data) throw new Error("Only admins can create payment links.");
    const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_SANDBOX_LOCATION_ID;
    if (!token || !locationId) return { error: "Square sandbox credentials are not set up." };

    const dues = await getMasterDues();
    if (dues.error || !dues.data) return { error: "Balances unavailable; no link created." };
    const row = dues.data.rows.find((r) => r.client_id === data.clientId);
    const { data: c } = await supabase.from("clients").select("package_start_date, pending_renewal_start_date, first_name, last_name").eq("id", data.clientId).maybeSingle();
    const { data: ovr } = await supabase.from("package_overrides").select("*").eq("client_id", data.clientId).is("cleared_at", null);
    const { applyOverridesToRows } = await import("./package-override");
    const eff: any = c ? applyOverridesToRows([c as any], ovr ?? [])[0] : null;
    const ob = obligationFor(row, { currentStart: eff?.package_start_date ?? null, preparedStart: eff?.pending_renewal_start_date ?? null });
    if (!ob.ok) return { error: `No link: ${ob.reason}` };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: active } = await supabaseAdmin.from("square_payment_links")
      .select("id, obligation_key, status, url").eq("client_id", ob.clientId).eq("environment", "sandbox").eq("status", "active").maybeSingle();
    const d = decideLink(active, ob);
    if (d.action === "reuse") return { error: null, url: d.link.url, amountCents: ob.amountCents, reused: true };
    if (d.supersede) await supabaseAdmin.from("square_payment_links").update({ status: "superseded" }).eq("id", d.supersede);

    const idem = idempotencyKeyFor(ob.obligationKey, "sandbox");
    const res = await fetch(`${SANDBOX}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": "2024-10-17" },
      body: JSON.stringify({
        idempotency_key: idem,
        order: {
          location_id: locationId,
          reference_id: ob.clientId.slice(0, 40),
          line_items: [{ name: "FIT Beyond Therapy package balance", quantity: "1", base_price_money: { amount: ob.amountCents, currency: "USD" } }],
        },
      }),
    });
    if (!res.ok) return { error: `Square sandbox error [${res.status}]: ${await res.text()}` };
    const j: any = await res.json();
    const pl = j.payment_link;
    const { error } = await supabaseAdmin.from("square_payment_links").upsert({
      client_id: ob.clientId, obligation_key: ob.obligationKey, amount_cents: ob.amountCents, environment: "sandbox",
      idempotency_key: idem, square_order_id: pl.order_id, square_link_id: pl.id, url: pl.url, status: "active", created_by: userId,
    }, { onConflict: "idempotency_key" });
    if (error) throw error;
    return { error: null, url: pl.url as string, amountCents: ob.amountCents, reused: false };
  });
