import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Square sends customer webhook events with this shape:
// { type, event_id, created_at, data: { type: "customer", id, object: { customer: {...} } } }

type SquareCustomer = {
  id?: string;
  given_name?: string | null;
  family_name?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
};

type SquareEvent = {
  type?: string;
  event_id?: string;
  data?: {
    id?: string;
    object?: { customer?: SquareCustomer };
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

        // If signature key isn't configured yet, reject; do NOT log raw events from
        // unverified callers.
        if (!sigKey || !notificationUrl) {
          return new Response("Webhook not configured", { status: 503 });
        }

        if (!signature || !verifySignature(notificationUrl, rawBody, signature, sigKey)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Always respond 200 after signature verification so Square doesn't retry
        // forever on our bugs. Errors are recorded in the sync log instead.
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
        const customer = event.data?.object?.customer;
        const squareCustomerId = customer?.id ?? event.data?.id ?? null;

        try {
          if (eventType !== "customer.created" && eventType !== "customer.updated") {
            await supabaseAdmin.from("square_sync_log").insert({
              event_type: eventType,
              square_customer_id: squareCustomerId,
              status: "skipped",
              message: "Event type not handled in this phase",
              raw_event: event as unknown as never,
            });
            return new Response("ok");
          }

          if (!squareCustomerId) {
            await supabaseAdmin.from("square_sync_log").insert({
              event_type: eventType,
              status: "error",
              message: "Event missing Square customer ID",
              raw_event: event as unknown as never,
            });
            return new Response("ok");
          }

          const firstName = (customer?.given_name ?? "").trim();
          const lastName = (customer?.family_name ?? "").trim();
          const email = (customer?.email_address ?? "").trim() || null;
          const phone = (customer?.phone_number ?? "").trim() || null;
          const hasName = Boolean(firstName || lastName);

          // Match by Square customer ID
          const { data: existing, error: lookupErr } = await supabaseAdmin
            .from("clients")
            .select("id, first_name, last_name")
            .eq("square_customer_id", squareCustomerId)
            .maybeSingle();

          if (lookupErr) throw lookupErr;

          if (existing) {
            // UPDATE: only contact fields. Never touch package / pricing / visits / scheduled / notes.
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
            return new Response("ok");
          }

          // CREATE: new client record mirroring Square contact info.
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
          return new Response("ok");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            await supabaseAdmin.from("square_sync_log").insert({
              event_type: eventType,
              square_customer_id: squareCustomerId,
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
