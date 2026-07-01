import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PaymentResolutionResult = {
  ok: true;
  client_id: string;
  applied_amount: number;
  already_applied: boolean;
  created_client: boolean;
};

export type PaymentMatchSuggestion = {
  client_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  amount_owed: number;
  reasons: string[];
  confidence: number; // count of reason categories matched
  nearest_appointment_at: string | null;
  square_customer_id: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyPaymentOnce(
  supabaseAdmin: any,
  {
    clientId,
    squarePaymentId,
    amountCents,
    matchMethod,
  }: {
    clientId: string;
    squarePaymentId: string;
    amountCents: number;
    matchMethod: string;
  },
): Promise<{ credited: boolean; appliedAmount: number; alreadyApplied: boolean }> {
  const { data: existingActivity } = await supabaseAdmin
    .from("client_activities")
    .select("id")
    .eq("client_id", clientId)
    .contains("metadata", { square_payment_id: squarePaymentId })
    .limit(1);
  if (existingActivity && existingActivity.length > 0) {
    return { credited: false, appliedAmount: 0, alreadyApplied: true };
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("amount_paid, package_price")
    .eq("id", clientId)
    .single();
  if (clientErr) throw clientErr;

  const amountDollars = amountCents / 100;
  const currentPaid = Number(client.amount_paid ?? 0);
  const price = Number(client.package_price ?? 0);
  const newPaid = price > 0 ? Math.min(price, currentPaid + amountDollars) : currentPaid + amountDollars;
  const appliedAmount = Math.max(0, newPaid - currentPaid);

  const { error: updErr } = await supabaseAdmin
    .from("clients")
    .update({ amount_paid: newPaid })
    .eq("id", clientId);
  if (updErr) throw updErr;

  await supabaseAdmin.from("client_activities").insert({
    client_id: clientId,
    activity_type: "payment",
    description: `Square payment synced — $${amountDollars.toFixed(2)}`,
    metadata: {
      source: "square",
      square_payment_id: squarePaymentId,
      amount: amountDollars,
      applied_amount: appliedAmount,
      match_method: matchMethod,
      manual_resolution: true,
    },
  });

  return { credited: true, appliedAmount, alreadyApplied: false };
}

export const searchClientsForPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data, context }) => {
    const q = data.query.trim();
    if (!q) return { clients: [] as Array<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; status: string }> };
    const pattern = `%${q}%`;
    const { data: rows, error } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, email, phone, status")
      .is("deleted_at", null)
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .order("last_name", { ascending: true })
      .limit(25);
    if (error) throw error;
    return { clients: rows ?? [] };
  });

export const resolvePaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { payment_row_id: string; client_id: string }) => d)
  .handler(async ({ data }): Promise<PaymentResolutionResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payment, error: pErr } = await supabaseAdmin
      .from("square_payments")
      .select("id, square_payment_id, square_customer_id, amount_cents, applied, buyer_email")
      .eq("id", data.payment_row_id)
      .single();
    if (pErr) throw pErr;
    if (payment.applied) {
      await supabaseAdmin
        .from("square_payments")
        .update({ client_id: data.client_id, needs_review: false })
        .eq("id", payment.id);
      return { ok: true, client_id: data.client_id, applied_amount: 0, already_applied: true, created_client: false };
    }

    const { data: client, error: cErr } = await supabaseAdmin
      .from("clients")
      .select("id, square_customer_id, first_name, last_name")
      .eq("id", data.client_id)
      .single();
    if (cErr) throw cErr;

    // Optionally attach square_customer_id if we have one and client doesn't
    if (payment.square_customer_id && !client.square_customer_id) {
      await supabaseAdmin
        .from("clients")
        .update({ square_customer_id: payment.square_customer_id })
        .eq("id", client.id);
    }

    const result = await applyPaymentOnce(supabaseAdmin, {
      clientId: client.id,
      squarePaymentId: payment.square_payment_id,
      amountCents: payment.amount_cents,
      matchMethod: "manual_resolution",
    });

    await supabaseAdmin
      .from("square_payments")
      .update({
        client_id: client.id,
        applied: true,
        needs_review: false,
      })
      .eq("id", payment.id);

    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_resolution",
      square_customer_id: payment.square_customer_id,
      client_id: client.id,
      status: "success",
      action: result.alreadyApplied ? "manual_link_already_credited" : "manual_link_applied",
      message: result.alreadyApplied
        ? `Manually linked payment ${payment.square_payment_id} to ${client.first_name} ${client.last_name} — activity already existed, flags reconciled`
        : `Manually linked payment ${payment.square_payment_id} ($${(payment.amount_cents / 100).toFixed(2)}) to ${client.first_name} ${client.last_name} (buyer_email=${payment.buyer_email ?? "none"})`,
    });

    return {
      ok: true,
      client_id: client.id,
      applied_amount: result.appliedAmount,
      already_applied: result.alreadyApplied,
      created_client: false,
    };
  });

export const resolvePaymentCreateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { payment_row_id: string; first_name: string; last_name: string; email?: string | null; phone?: string | null }) => d,
  )
  .handler(async ({ data }): Promise<PaymentResolutionResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payment, error: pErr } = await supabaseAdmin
      .from("square_payments")
      .select("id, square_payment_id, square_customer_id, amount_cents, applied, buyer_email")
      .eq("id", data.payment_row_id)
      .single();
    if (pErr) throw pErr;

    const first = (data.first_name || "").trim() || "Unnamed";
    const last = (data.last_name || "").trim() || "Client";
    const email = (data.email ?? payment.buyer_email ?? "").trim() || null;
    const phone = (data.phone ?? "").trim() || null;

    const { data: created, error: insErr } = await supabaseAdmin
      .from("clients")
      .insert({
        first_name: first,
        last_name: last,
        email,
        phone,
        square_customer_id: payment.square_customer_id,
        status: "active",
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    await supabaseAdmin.from("client_activities").insert({
      client_id: created.id,
      activity_type: "created",
      description: `Client created from unmatched Square payment ${payment.square_payment_id}`,
      metadata: { source: "manual_payment_resolution", square_payment_id: payment.square_payment_id },
    });

    let appliedAmount = 0;
    let alreadyApplied = false;
    if (!payment.applied) {
      const result = await applyPaymentOnce(supabaseAdmin, {
        clientId: created.id,
        squarePaymentId: payment.square_payment_id,
        amountCents: payment.amount_cents,
        matchMethod: "manual_create_client",
      });
      appliedAmount = result.appliedAmount;
      alreadyApplied = result.alreadyApplied;
    }

    await supabaseAdmin
      .from("square_payments")
      .update({
        client_id: created.id,
        applied: true,
        needs_review: false,
      })
      .eq("id", payment.id);

    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_resolution",
      square_customer_id: payment.square_customer_id,
      client_id: created.id,
      status: "success",
      action: "manual_create_client_applied",
      message: `Created new client ${first} ${last} from payment ${payment.square_payment_id} ($${(payment.amount_cents / 100).toFixed(2)}, buyer_email=${payment.buyer_email ?? "none"})`,
    });

    return {
      ok: true,
      client_id: created.id,
      applied_amount: appliedAmount,
      already_applied: alreadyApplied,
      created_client: true,
    };
  });
