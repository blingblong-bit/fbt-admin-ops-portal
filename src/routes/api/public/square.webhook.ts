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

        // Production read-only webhook receiver. Log non-secret diagnostics only.
        console.log(
          `[square-webhook] env=production base=https://connect.squareup.com ` +
            `secret_name=SQUARE_WEBHOOK_SIGNATURE_KEY url_name=SQUARE_WEBHOOK_NOTIFICATION_URL ` +
            `sig_present=${Boolean(signature)} sig_key_present=${Boolean(sigKey)} url_present=${Boolean(notificationUrl)}`,
        );

        if (!sigKey || !notificationUrl) {
          return new Response("Webhook not configured", { status: 503 });
        }

        const verified = signature ? verifySignature(notificationUrl, rawBody, signature, sigKey) : false;
        console.log(`[square-webhook] signature_verified=${verified}`);
        if (!verified) {
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
        const obj = event.data?.object ?? {};
        console.log(
          `[square-webhook] event_type=${eventType} ` +
            `customer_id=${obj.customer?.id ?? obj.payment?.customer_id ?? obj.booking?.customer_id ?? "none"} ` +
            `payment_id=${obj.payment?.id ?? "none"} booking_id=${obj.booking?.id ?? "none"}`,
        );


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
          const message = formatErr(err);
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

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [e.message, e.code ? `code=${e.code}` : null, e.details, e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return String(err);
}

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
async function matchClient(
  supabaseAdmin: any,
  {
    existingClientId,
    squareCustomerId,
    buyerEmail,
  }: { existingClientId: string | null; squareCustomerId: string | null; buyerEmail: string | null },
): Promise<{ clientId: string | null; method: string | null }> {
  if (existingClientId) return { clientId: existingClientId, method: "existing_client_id" };

  if (squareCustomerId) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("square_customer_id", squareCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (data) return { clientId: data.id, method: "square_customer_id" };
  }

  if (buyerEmail) {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id")
      .ilike("email", buyerEmail)
      .is("deleted_at", null);
    if (data && data.length === 1) return { clientId: data[0].id, method: "email" };
  }

  return { clientId: null, method: null };
}

// Applies a payment to a client's balance exactly once. Implementation lives
// in @/lib/payment-apply and is shared with the manual-resolution flows.


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
  const isCompleted = status === "COMPLETED";
  const amountDisplay = `$${(amountCents / 100).toFixed(2)}`;

  const { data: existingPayment, error: existingErr } = await supabaseAdmin
    .from("square_payments")
    .select("id, applied, client_id")
    .eq("square_payment_id", squarePaymentId)
    .maybeSingle();
  if (existingErr) throw existingErr;

  // ============ Existing payment row ============
  if (existingPayment) {
    // Already applied → nothing to do beyond status refresh
    if (existingPayment.applied) {
      await supabaseAdmin
        .from("square_payments")
        .update({ status, raw_event: event as unknown as never })
        .eq("id", existingPayment.id);
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: eventType,
        square_customer_id: squareCustomerId,
        client_id: existingPayment.client_id,
        status: "skipped",
        action: "already_applied",
        message: `Payment ${squarePaymentId} already applied — status refreshed to ${status}`,
        raw_event: event as unknown as never,
      });
      return;
    }

    // Not yet applied — only proceed when COMPLETED and amount > 0
    if (!isCompleted || amountCents <= 0) {
      // If we already have a matched client, clear needs_review so it drops out
      // of the review queue and shows up as a pending/approved payment instead.
      await supabaseAdmin
        .from("square_payments")
        .update({
          status,
          needs_review: existingPayment.client_id ? false : true,
          raw_event: event as unknown as never,
        })
        .eq("id", existingPayment.id);
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: eventType,
        square_customer_id: squareCustomerId,
        client_id: existingPayment.client_id,
        status: "skipped",
        action: `recorded_status_${status.toLowerCase() || "unknown"}`,
        message: existingPayment.client_id
          ? `Payment ${squarePaymentId} status=${status} — matched, waiting for COMPLETED`
          : `Payment ${squarePaymentId} status=${status} — not applied (waiting for COMPLETED)`,
        raw_event: event as unknown as never,
      });
      return;
    }

    // Re-run match, preferring existing client_id
    const { clientId, method } = await matchClient(supabaseAdmin, {
      existingClientId: existingPayment.client_id,
      squareCustomerId,
      buyerEmail,
    });

    if (!clientId) {
      await supabaseAdmin
        .from("square_payments")
        .update({ status, needs_review: true, raw_event: event as unknown as never })
        .eq("id", existingPayment.id);
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: eventType,
        square_customer_id: squareCustomerId,
        status: "skipped",
        action: "needs_review_no_match",
        message: `Payment ${squarePaymentId} (${amountDisplay}) COMPLETED but no client match — needs review`,
        raw_event: event as unknown as never,
      });
      return;
    }

    let result: { credited: boolean; appliedAmount: number; alreadyApplied: boolean } | null = null;
    let applyErr: unknown = null;
    try {
      result = await applyPaymentOnce(supabaseAdmin, {
        clientId,
        squarePaymentId,
        amountCents,
        matchMethod: method,
      });
    } catch (e) {
      applyErr = e;
    }

    if (applyErr || !result) {
      // Credit failed (e.g. clients_validate trigger blocked because package_price=0
      // or amount would exceed price). Keep needs_review=true so staff can act.
      await supabaseAdmin
        .from("square_payments")
        .update({ status, client_id: clientId, needs_review: true, raw_event: event as unknown as never })
        .eq("id", existingPayment.id);
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: eventType,
        square_customer_id: squareCustomerId,
        client_id: clientId,
        status: "error",
        action: "apply_blocked",
        message: `COMPLETED payment ${squarePaymentId} (${amountDisplay}) matched to client but credit was blocked: ${formatErr(applyErr)}`,
        raw_event: event as unknown as never,
      });
      return;
    }

    await supabaseAdmin
      .from("square_payments")
      .update({
        status,
        client_id: clientId,
        applied: true,
        needs_review: false,
        raw_event: event as unknown as never,
      })
      .eq("id", existingPayment.id);

    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      square_customer_id: squareCustomerId,
      client_id: clientId,
      status: "success",
      action: result.alreadyApplied
        ? "reconciled_already_credited"
        : `applied_payment_${method ?? "unknown"}`,
      message: result.alreadyApplied
        ? `Payment ${squarePaymentId} activity already existed on client — reconciled flags (applied=true, needs_review=false)`
        : `Applied ${amountDisplay} to client via ${method} (promoted from APPROVED→COMPLETED)`,
      raw_event: event as unknown as never,
    });
    return;
  }

  // ============ New payment row ============
  const { clientId, method } = await matchClient(supabaseAdmin, {
    existingClientId: null,
    squareCustomerId,
    buyerEmail,
  });

  let applied = false;
  let alreadyApplied = false;
  let applyErr: unknown = null;
  if (clientId && isCompleted && amountCents > 0) {
    try {
      const result = await applyPaymentOnce(supabaseAdmin, {
        clientId,
        squarePaymentId,
        amountCents,
        matchMethod: method,
      });
      applied = true;
      alreadyApplied = result.alreadyApplied;
    } catch (e) {
      applyErr = e;
    }
  }

  // Needs review only when we can't identify the customer OR when a COMPLETED
  // matched payment failed to apply (trigger blocked). Matched-but-not-completed
  // rows are "pending", not review.
  const needsReview = !clientId || (isCompleted && !applied);

  await supabaseAdmin.from("square_payments").insert({
    square_payment_id: squarePaymentId,
    square_customer_id: squareCustomerId,
    client_id: clientId,
    amount_cents: amountCents,
    currency,
    status,
    applied,
    needs_review: needsReview,
    buyer_email: buyerEmail,
    note,
    raw_event: event as unknown as never,
  });

  await supabaseAdmin.from("square_sync_log").insert({
    event_type: eventType,
    square_customer_id: squareCustomerId,
    client_id: clientId,
    status: applied ? "success" : applyErr ? "error" : "skipped",
    action: applied
      ? alreadyApplied
        ? "reconciled_already_credited"
        : `applied_payment_${method ?? "unknown"}`
      : applyErr
        ? "apply_blocked"
        : clientId
          ? `recorded_status_${status.toLowerCase() || "unknown"}`
          : "needs_review_no_match",
    message: applied
      ? alreadyApplied
        ? `Payment ${squarePaymentId} (${amountDisplay}) already credited — flags set applied=true`
        : `Applied ${amountDisplay} to client via ${method}`
      : applyErr
        ? `COMPLETED payment ${squarePaymentId} (${amountDisplay}) matched to client but credit was blocked: ${formatErr(applyErr)}`
        : clientId
          ? `Recorded payment ${squarePaymentId} (${amountDisplay}, status=${status}) — matched, waiting for COMPLETED`
          : `No client match for payment ${squarePaymentId} (${amountDisplay}) — flagged for review`,
    raw_event: event as unknown as never,
  });
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleBookingEvent(supabaseAdmin: any, eventType: string, event: SquareEvent) {
  const booking = event.data?.object?.booking;
  const bookingId = booking?.id ?? event.data?.id ?? null;
  const status = (booking?.status ?? "").toString().toUpperCase();
  const squareCustomerId = booking?.customer_id ?? null;
  const startAt = booking?.start_at ?? null;

  if (!bookingId) {
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: eventType,
      status: "error",
      message: "Event missing Square booking ID",
      raw_event: event as unknown as never,
    });
    return;
  }

  // Match to client by square_customer_id (read-only match) — include archived/inactive
  // so a new booking can auto-restore them.
  let matchedClientId: string | null = null;
  let matchedStatus: string | null = null;
  if (squareCustomerId) {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, status")
      .eq("square_customer_id", squareCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (client) {
      matchedClientId = client.id;
      matchedStatus = (client as { status?: string | null }).status ?? null;
    }
  }

  const isCancelled = /^(CANCELLED|CANCELED|DECLINED|NO_SHOW)$/.test(status);
  const isDeleted = eventType === "booking.updated" && /^DELETED$/.test(status);
  const treatAsNotScheduled = isCancelled || isDeleted;
  const isActiveBooking = !treatAsNotScheduled;

  // Auto-restore from archive when a new active booking is created/updated.
  let restored = false;
  if (
    matchedClientId &&
    isActiveBooking &&
    (matchedStatus === "archived" || matchedStatus === "assessment")
  ) {
    // Decide target: if there's a package, treat as active; otherwise assessment.
    const { data: full } = await supabaseAdmin
      .from("clients")
      .select("package_total_visits")
      .eq("id", matchedClientId)
      .maybeSingle();
    const target =
      ((full as { package_total_visits?: number | null } | null)?.package_total_visits ?? 0) > 0
        ? "active"
        : "assessment";
    if (target !== matchedStatus) {
      await supabaseAdmin
        .from("clients")
        .update({ status: target })
        .eq("id", matchedClientId);
      await supabaseAdmin.from("client_activities").insert({
        client_id: matchedClientId,
        activity_type: "restored",
        description: `Restored from archive due to new Square appointment (now ${target}).`,
        metadata: { source: "square_booking", booking_id: bookingId, status, target } as unknown as never,
      });
      restored = true;
    }
  }

  const action = restored
    ? "booking_restored_from_archive"
    : treatAsNotScheduled
      ? "booking_not_scheduled"
      : status === "ACCEPTED" || status === "PENDING"
        ? "booking_active"
        : `booking_status_${status.toLowerCase() || "unknown"}`;

  const startDisplay = startAt ? new Date(startAt).toISOString() : "unknown time";
  const baseMsg = matchedClientId
    ? `Booking ${bookingId} (${startDisplay}) status=${status || "UNKNOWN"}${treatAsNotScheduled ? " — treated as not scheduled" : ""}`
    : `Booking ${bookingId} (${startDisplay}) status=${status || "UNKNOWN"} — no matching client (unmatched)`;
  const message = restored ? `${baseMsg} — auto-restored from archive` : baseMsg;

  await supabaseAdmin.from("square_sync_log").insert({
    event_type: eventType,
    square_customer_id: squareCustomerId,
    client_id: matchedClientId,
    status: matchedClientId ? "success" : "skipped",
    action,
    message,
    raw_event: event as unknown as never,
  });
}

