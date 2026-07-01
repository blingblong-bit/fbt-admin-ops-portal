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
  confidence: number; // count of reason categories matched (kept for backwards compat)
  score: number; // weighted total
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

// --- Suggestion helpers ---

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

type SquareBookingLite = {
  id: string;
  start_at?: string | null;
  customer_id?: string | null;
  status?: string | null;
};

function cleanToken(t: string | undefined | null): string {
  return (t ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

async function fetchBookingsInWindow(
  token: string,
  startIso: string,
  endIso: string,
): Promise<SquareBookingLite[]> {
  const out: SquareBookingLite[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const url = new URL(`${SQUARE_BASE}/v2/bookings`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("start_at_min", startIso);
    url.searchParams.set("start_at_max", endIso);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) break;
    const json = (await res.json()) as { bookings?: SquareBookingLite[]; cursor?: string };
    if (json.bookings?.length) out.push(...json.bookings);
    cursor = json.cursor;
    if (!cursor) break;
  }
  return out;
}

type SquareCustomerLite = {
  given_name?: string | null;
  family_name?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
};

async function fetchCustomer(token: string, id: string): Promise<SquareCustomerLite | null> {
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/customers/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { customer?: SquareCustomerLite };
    return json.customer ?? null;
  } catch {
    return null;
  }
}

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

export const suggestPaymentMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { payment_row_id: string }) => d)
  .handler(async ({ data, context }): Promise<{ suggestions: PaymentMatchSuggestion[]; note: string | null }> => {
    const { data: payment, error: pErr } = await context.supabase
      .from("square_payments")
      .select("id, created_at, amount_cents, buyer_email, square_customer_id")
      .eq("id", data.payment_row_id)
      .single();
    if (pErr) throw pErr;

    const amountDollars = payment.amount_cents / 100;
    const paymentTs = new Date(payment.created_at).getTime();
    const windowMs = 2 * 60 * 60 * 1000;
    const startIso = new Date(paymentTs - windowMs).toISOString();
    const endIso = new Date(paymentTs + windowMs).toISOString();

    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    let note: string | null = null;
    let bookings: SquareBookingLite[] = [];
    if (!token) {
      note = "Square token not configured — appointment-based suggestions unavailable.";
    } else {
      bookings = await fetchBookingsInWindow(token, startIso, endIso);
    }

    // Load all non-deleted clients (paginated)
    type ClientRow = {
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
      status: string;
      package_price: number;
      amount_paid: number;
      square_customer_id: string | null;
    };
    const clients: ClientRow[] = [];
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const { data: rows, error } = await context.supabase
        .from("clients")
        .select(
          "id, first_name, last_name, email, phone, status, package_price, amount_paid, square_customer_id",
        )
        .is("deleted_at", null)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      clients.push(...(rows as ClientRow[]));
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const byCustomerId = new Map<string, ClientRow>();
    for (const c of clients) if (c.square_customer_id) byCustomerId.set(c.square_customer_id, c);

    // reason accumulator
    const map = new Map<string, { client: ClientRow; reasons: string[]; categories: Set<string>; nearestApptAt: string | null; nearestDeltaMin: number }>();
    const addReason = (client: ClientRow, reason: string, category: string, apptAt: string | null = null) => {
      const e = map.get(client.id);
      const deltaMin = apptAt ? Math.abs(new Date(apptAt).getTime() - paymentTs) / 60000 : Number.POSITIVE_INFINITY;
      if (!e) {
        map.set(client.id, {
          client,
          reasons: [reason],
          categories: new Set([category]),
          nearestApptAt: apptAt,
          nearestDeltaMin: deltaMin,
        });
      } else {
        e.reasons.push(reason);
        e.categories.add(category);
        if (apptAt && deltaMin < e.nearestDeltaMin) {
          e.nearestApptAt = apptAt;
          e.nearestDeltaMin = deltaMin;
        }
      }
    };

    // 1) Appointment window matches (linked customers)
    const unmatchedCustomerIds = new Set<string>();
    for (const b of bookings) {
      if (!b.start_at || !b.customer_id) continue;
      if (/CANCELLED|DECLINED|NO_SHOW/i.test(b.status ?? "")) continue;
      const c = byCustomerId.get(b.customer_id);
      const deltaMin = Math.round(Math.abs(new Date(b.start_at).getTime() - paymentTs) / 60000);
      if (c) {
        const t = new Date(b.start_at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
        addReason(c, `Appointment ${t} (${deltaMin}m from payment)`, "appointment", b.start_at);
      } else {
        unmatchedCustomerIds.add(b.customer_id);
      }
    }

    // 2) Amount owed match — within $1
    if (amountDollars > 0) {
      for (const c of clients) {
        const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
        if (owed > 0 && Math.abs(owed - amountDollars) <= 1) {
          addReason(c, `Owes $${owed.toFixed(2)} (matches payment)`, "amount");
        }
      }
    }

    // 3) Buyer email match
    if (payment.buyer_email) {
      const target = payment.buyer_email.trim().toLowerCase();
      for (const c of clients) {
        if (c.email && c.email.trim().toLowerCase() === target) {
          addReason(c, `Buyer email match (${c.email})`, "email");
        }
      }
    }

    // 4) Name matches via nearby unmatched bookings — look up Square customer info
    if (token && unmatchedCustomerIds.size > 0) {
      const ids = Array.from(unmatchedCustomerIds).slice(0, 20);
      const infos = await Promise.all(ids.map(async (id) => ({ id, info: await fetchCustomer(token, id) })));
      // find the booking start_at for each id
      const apptById = new Map<string, string>();
      for (const b of bookings) {
        if (b.customer_id && b.start_at && !apptById.has(b.customer_id)) apptById.set(b.customer_id, b.start_at);
      }
      for (const { id, info } of infos) {
        if (!info) continue;
        const full = normName(`${info.given_name ?? ""}${info.family_name ?? ""}`);
        if (!full) continue;
        for (const c of clients) {
          const cf = normName(`${c.first_name}${c.last_name}`);
          if (cf && cf === full) {
            const apptAt = apptById.get(id) ?? null;
            const label = `${info.given_name ?? ""} ${info.family_name ?? ""}`.trim();
            addReason(
              c,
              apptAt
                ? `Name match on nearby booking (${label})`
                : `Name match (${label})`,
              "name",
              apptAt,
            );
          }
        }
      }
    }

    const suggestions: PaymentMatchSuggestion[] = Array.from(map.values())
      .map(({ client, reasons, categories, nearestApptAt }) => ({
        client_id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        phone: client.phone,
        status: client.status,
        amount_owed: Math.max(0, Number(client.package_price ?? 0) - Number(client.amount_paid ?? 0)),
        reasons,
        confidence: categories.size,
        nearest_appointment_at: nearestApptAt,
        square_customer_id: client.square_customer_id,
      }))
      .sort((a, b) => b.confidence - a.confidence || a.last_name.localeCompare(b.last_name))
      .slice(0, 10);

    return { suggestions, note };
  });
