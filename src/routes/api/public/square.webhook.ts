import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Square sends webhook events with this shape:
// { type, event_id, created_at, data: { type, id, object: { customer|payment: {...} } } }

type SquareCustomer = {
  id?: string;
  given_name?: string | null;
  family_name?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
};

type SquareMoney = { amount?: number | null; currency?: string | null };

type SquarePayment = {
  id?: string;
  status?: string | null;
  amount_money?: SquareMoney | null;
  total_money?: SquareMoney | null;
  customer_id?: string | null;
  buyer_email_address?: string | null;
  note?: string | null;
};

type SquareBookingSegment = {
  service_variation_id?: string | null;
  duration_minutes?: number | null;
};

type SquareBooking = {
  id?: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
  appointment_segments?: SquareBookingSegment[] | null;
};

type SquareEvent = {
  type?: string;
  event_id?: string;
  data?: {
    id?: string;
    object?: {
      customer?: SquareCustomer;
      payment?: SquarePayment;
      booking?: SquareBooking;
    };
  };
};

function verifySignature(notificationUrl: string, body: string, signature: string, key: string) {
  const expected = createHmac("sha256", key)
    .update(notificationUrl + body)
    .digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}


export const Route = createFileRoute("/api/public/square/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const sigKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
        const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;

        const rawBody = await request.text();
        const signature =
          request.headers.get("x-square-hmacsha256-signature") ??
          request.headers.get("X-Square-HmacSHA256-Signature") ??
          "";

        if (!sigKey || !notificationUrl) {
          return new Response("Webhook not configured", { status: 503 });
        }

        if (!signature || !verifySignature(notificationUrl, rawBody, signature, sigKey)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let event: SquareEvent = {};
        try {
          event = JSON.parse(rawBody) as SquareEvent;
        } catch (err) {
          await supabaseAdmin.from("square_sync_log").insert({
            event_type: "unknown",
            status: "error",
            message: `Invalid JSON: ${(err as Error).message}`,
          });
          return new Response("ok");
        }

        const eventType = event.type ?? "unknown";

        try {
          if (eventType === "customer.created" || eventType === "customer.updated") {
            await handleCustomerEvent(supabaseAdmin, eventType, event);
            return new Response("ok");
          }
          if (eventType === "payment.created" || eventType === "payment.updated") {
            await handlePaymentEvent(supabaseAdmin, eventType, event);
            return new Response("ok");
          }
          if (
            eventType === "booking.created" ||
            eventType === "booking.updated"
          ) {
            await handleBookingEvent(supabaseAdmin, eventType, event);
            return new Response("ok");
          }

          await supabaseAdmin.from("square_sync_log").insert({
            event_type: eventType,
            status: "skipped",
            message: "Event type not handled in this phase",
            raw_event: event as unknown as never,
          });
          return new Response("ok");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            await supabaseAdmin.from("square_sync_log").insert({
              event_type: eventType,
              status: "error",
              message,
              raw_event: event as unknown as never,
            });
          } catch {
            // Swallow logging errors so we always return 200.
          }
          return new Response("ok");
        }
      },
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCustomerEvent(supabaseAdmin: any, eventType: string, event: SquareEvent) {
  const customer = event.data?.object?.customer;
  const squareCustomerId = customer?.id ?? event.data?.id ?? null;

  if (!squareCustomerId) {
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      status: "error",
      message: "Event missing Square customer ID",
      raw_event: event as unknown as never,
    });
    return;
  }

  const firstName = (customer?.given_name ?? "").trim();
  const lastName = (customer?.family_name ?? "").trim();
  const email = (customer?.email_address ?? "").trim() || null;
  const phone = (customer?.phone_number ?? "").trim() || null;
  const hasName = Boolean(firstName || lastName);

  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("clients")
    .select("id, first_name, last_name")
    .eq("square_customer_id", squareCustomerId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existing) {
    const updates: { email: string | null; phone: string | null; first_name?: string; last_name?: string } = {
      email,
      phone,
    };
    if (hasName) {
      updates.first_name = firstName || existing.first_name;
      updates.last_name = lastName || existing.last_name;
    }
    const { error: updateErr } = await supabaseAdmin
      .from("clients")
      .update(updates)
      .eq("id", existing.id);
    if (updateErr) throw updateErr;

    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      square_customer_id: squareCustomerId,
      client_id: existing.id,
      status: "success",
      action: "updated_contact",
      message: "Updated contact fields only",
      raw_event: event as unknown as never,
    });
    return;
  }

  const insertRow = {
    first_name: hasName ? firstName || "(no first name)" : "Unnamed",
    last_name: hasName ? lastName || "" : "Square Customer",
    email,
    phone,
    square_customer_id: squareCustomerId,
    needs_review: !hasName,
  };

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("clients")
    .insert(insertRow)
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  await supabaseAdmin.from("square_sync_log").insert({
    event_type: eventType,
    square_customer_id: squareCustomerId,
    client_id: created.id,
    status: "success",
    action: hasName ? "created" : "created_unnamed_flagged",
    message: hasName
      ? "Created client from Square customer"
      : "Created as 'Unnamed Square Customer' — flagged for review",
    raw_event: event as unknown as never,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentEvent(supabaseAdmin: any, eventType: string, event: SquareEvent) {
  const payment = event.data?.object?.payment;
  const squarePaymentId = payment?.id ?? event.data?.id ?? null;

  if (!squarePaymentId) {
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      status: "error",
      message: "Event missing Square payment ID",
      raw_event: event as unknown as never,
    });
    return;
  }

  const money = payment?.amount_money ?? payment?.total_money ?? null;
  const amountCents = Number(money?.amount ?? 0);
  const currency = (money?.currency ?? "USD").toString();
  const status = (payment?.status ?? "").toString().toUpperCase();
  const squareCustomerId = payment?.customer_id ?? null;
  const buyerEmail = payment?.buyer_email_address ?? null;
  const note = payment?.note ?? null;

  // Check if we've already recorded this payment
  const { data: existingPayment, error: existingErr } = await supabaseAdmin
    .from("square_payments")
    .select("id, applied, client_id")
    .eq("square_payment_id", squarePaymentId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  // Only completed payments are applied to balances
  const isCompleted = status === "COMPLETED";

  if (existingPayment) {
    // Update status; never re-apply
    await supabaseAdmin
      .from("square_payments")
      .update({ status, raw_event: event as unknown as never })
      .eq("id", existingPayment.id);

    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      square_customer_id: squareCustomerId,
      client_id: existingPayment.client_id,
      status: "skipped",
      action: "already_processed",
      message: `Payment ${squarePaymentId} already processed (applied=${existingPayment.applied}, status=${status})`,
      raw_event: event as unknown as never,
    });
    return;
  }

  // Attempt to match a client
  let matchedClientId: string | null = null;
  let matchMethod: string | null = null;

  if (squareCustomerId) {
    const { data: byCustomer } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("square_customer_id", squareCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (byCustomer) {
      matchedClientId = byCustomer.id;
      matchMethod = "square_customer_id";
    }
  }

  if (!matchedClientId && buyerEmail) {
    const { data: byEmail } = await supabaseAdmin
      .from("clients")
      .select("id")
      .ilike("email", buyerEmail)
      .is("deleted_at", null);
    if (byEmail && byEmail.length === 1) {
      matchedClientId = byEmail[0].id;
      matchMethod = "email";
    }
  }

  const needsReview = !matchedClientId || !isCompleted;
  let applied = false;
  let appliedAmount = 0;

  if (matchedClientId && isCompleted && amountCents > 0) {
    // Apply payment: amount_paid += amount, capped at package_price
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("amount_paid, package_price")
      .eq("id", matchedClientId)
      .single();
    if (clientErr) throw clientErr;

    const amountDollars = amountCents / 100;
    const currentPaid = Number(client.amount_paid ?? 0);
    const price = Number(client.package_price ?? 0);
    const newPaid = price > 0 ? Math.min(price, currentPaid + amountDollars) : currentPaid + amountDollars;
    appliedAmount = Math.max(0, newPaid - currentPaid);

    const { error: updErr } = await supabaseAdmin
      .from("clients")
      .update({ amount_paid: newPaid })
      .eq("id", matchedClientId);
    if (updErr) throw updErr;

    await supabaseAdmin.from("client_activities").insert({
      client_id: matchedClientId,
      activity_type: "payment",
      description: `Square payment synced — $${amountDollars.toFixed(2)}`,
      metadata: {
        source: "square",
        square_payment_id: squarePaymentId,
        amount: amountDollars,
        applied_amount: appliedAmount,
        match_method: matchMethod,
      } as unknown as never,
    });
    applied = true;
  }

  await supabaseAdmin.from("square_payments").insert({
    square_payment_id: squarePaymentId,
    square_customer_id: squareCustomerId,
    client_id: matchedClientId,
    amount_cents: amountCents,
    currency,
    status,
    applied,
    needs_review: needsReview && !applied,
    buyer_email: buyerEmail,
    note,
    raw_event: event as unknown as never,
  });

  const amountDisplay = `$${(amountCents / 100).toFixed(2)}`;
  await supabaseAdmin.from("square_sync_log").insert({
    event_type: eventType,
    square_customer_id: squareCustomerId,
    client_id: matchedClientId,
    status: applied ? "success" : needsReview ? "skipped" : "skipped",
    action: applied
      ? `applied_payment_${matchMethod ?? "unknown"}`
      : matchedClientId
        ? `recorded_status_${status.toLowerCase() || "unknown"}`
        : "needs_review_no_match",
    message: applied
      ? `Applied ${amountDisplay} to client via ${matchMethod}`
      : matchedClientId
        ? `Recorded payment ${squarePaymentId} (${amountDisplay}, status=${status}) — not applied`
        : `No client match for payment ${squarePaymentId} (${amountDisplay}) — flagged for review`,
    raw_event: event as unknown as never,
  });
}
