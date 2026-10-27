import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { handleLinkPayment, supabaseLinkDb } from "@/lib/payment-link-handler";
import { applyPaymentOnce } from "@/lib/payment-apply";

// Square SANDBOX webhook — separate key/URL from production. Only sandbox
// checkout-link orders are looked up, and only test-fixture clients are ever
// credited; it never writes the production payment ledger.
function verify(url: string, body: string, sig: string, key: string) {
  const a = Buffer.from(sig);
  const b = Buffer.from(createHmac("sha256", key).update(url + body).digest("base64"));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/square/sandbox-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.SQUARE_SANDBOX_WEBHOOK_SIGNATURE_KEY;
        const url = process.env.SQUARE_SANDBOX_WEBHOOK_NOTIFICATION_URL;
        if (!key || !url) return new Response("Sandbox webhook not configured", { status: 503 });
        const body = await request.text();
        const sig = request.headers.get("x-square-hmacsha256-signature") ?? "";
        if (!sig || !verify(url, body, sig, key)) return new Response("Invalid signature", { status: 401 });

        let ev: any;
        try { ev = JSON.parse(body); } catch { return new Response("ok"); }
        const pay = ev?.data?.object?.payment;
        if (!/^payment\.(created|updated)$/.test(ev?.type ?? "") || !pay?.id) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseLinkDb(supabaseAdmin, "sandbox", (clientId, paymentId, cents) =>
          applyPaymentOnce(supabaseAdmin, { clientId, squarePaymentId: `sandbox:${paymentId}`, amountCents: cents, matchMethod: "sandbox_payment_link" }));
        const money = pay.amount_money ?? pay.total_money ?? {};
        const r = await handleLinkPayment(db, "sandbox", {
          orderId: pay.order_id ?? null, paymentId: pay.id, amountCents: Number(money.amount ?? 0), status: String(pay.status ?? ""),
        });
        console.info(`[square-sandbox-webhook] payment=${pay.id} result=${r.kind}`);
        return new Response("ok");
      },
    },
  },
});
