import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { applyPaymentOnce } from "@/lib/payment-apply";

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
      manualResolution: true,
    });


    await supabaseAdmin
      .from("square_payments")
      .update({
        client_id: client.id,
        applied: true,
        needs_review: false,
      })
      .eq("id", payment.id);

    const appliedZero = !result.alreadyApplied && !(result.appliedAmount > 0);
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_resolution",
      square_customer_id: payment.square_customer_id,
      client_id: client.id,
      status: appliedZero ? "applied_zero" : "success",
      action: result.alreadyApplied
        ? "manual_link_already_credited"
        : appliedZero
          ? "manual_link_applied_zero"
          : "manual_link_applied",
      message: result.alreadyApplied
        ? `Manually linked payment ${payment.square_payment_id} to ${client.first_name} ${client.last_name} — activity already existed, flags reconciled`
        : appliedZero
          ? `Manually linked payment ${payment.square_payment_id} ($${(payment.amount_cents / 100).toFixed(2)}) to ${client.first_name} ${client.last_name} but $0 credited — package_price cap already reached`
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
        manualResolution: true,
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
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { customer?: SquareCustomerLite };
    return json.customer ?? null;
  } catch {
    // Includes AbortError from the 5s timeout — swallow and let the caller
    // build suggestions from the remaining customers.
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
    const halfHourMs = 30 * 60 * 1000;
    const twoHourMs = 2 * 60 * 60 * 1000;
    const twelveHourMs = 12 * 60 * 60 * 1000;
    // Fetch a wider window (±12h) to detect same-day bookings, then classify per booking.
    const startIso = new Date(paymentTs - twelveHourMs).toISOString();
    const endIso = new Date(paymentTs + twelveHourMs).toISOString();

    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    let note: string | null = null;
    let bookings: SquareBookingLite[] = [];
    if (!token) {
      note = "Square token not configured — appointment-based suggestions unavailable.";
    } else {
      bookings = await fetchBookingsInWindow(token, startIso, endIso);
    }

    // Load all non-deleted clients (paginated, ordered for stable ranges)
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
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      clients.push(...(rows as ClientRow[]));
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const byCustomerId = new Map<string, ClientRow>();
    for (const c of clients) if (c.square_customer_id) byCustomerId.set(c.square_customer_id, c);

    // Per-client signal accumulator. Each category records its best contribution.
    type ApptTier = "within30" | "within2h" | "sameday";
    type Signals = {
      email?: { reason: string };
      amount?: { reason: string };
      appt?: { tier: ApptTier; reason: string; apptAt: string; deltaMin: number };
      name?: { reason: string; sameDay: boolean };
    };
    const perClient = new Map<string, { client: ClientRow; signals: Signals }>();
    const ensure = (c: ClientRow) => {
      let e = perClient.get(c.id);
      if (!e) {
        e = { client: c, signals: {} };
        perClient.set(c.id, e);
      }
      return e;
    };

    const isSameDay = (a: number, b: number) =>
      new Date(a).toDateString() === new Date(b).toDateString();
    const fmtTime = (iso: string) =>
      new Date(iso).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      });

    // 1) Appointment matches for linked customers (best tier wins)
    const unmatchedCustomerIds = new Set<string>();
    for (const b of bookings) {
      if (!b.start_at || !b.customer_id) continue;
      if (/CANCELLED|DECLINED|NO_SHOW/i.test(b.status ?? "")) continue;
      const c = byCustomerId.get(b.customer_id);
      const bTs = new Date(b.start_at).getTime();
      const deltaMs = Math.abs(bTs - paymentTs);
      if (c) {
        let tier: ApptTier | null = null;
        if (deltaMs <= halfHourMs) tier = "within30";
        else if (deltaMs <= twoHourMs) tier = "within2h";
        else if (isSameDay(bTs, paymentTs)) tier = "sameday";
        if (!tier) continue;
        const deltaMin = Math.round(deltaMs / 60000);
        const reason =
          tier === "sameday"
            ? `Same-day appointment ${fmtTime(b.start_at)}`
            : `Appointment ${fmtTime(b.start_at)} (${deltaMin}m from payment)`;
        const e = ensure(c);
        const rank = { within30: 3, within2h: 2, sameday: 1 } as const;
        if (!e.signals.appt || rank[tier] > rank[e.signals.appt.tier]) {
          e.signals.appt = { tier, reason, apptAt: b.start_at, deltaMin };
        }
      } else {
        unmatchedCustomerIds.add(b.customer_id);
      }
    }

    // 2) Amount owed match — within $1
    if (amountDollars > 0) {
      for (const c of clients) {
        const owed = Math.max(0, Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0));
        if (owed > 0 && Math.abs(owed - amountDollars) <= 1) {
          ensure(c).signals.amount = { reason: `Owes $${owed.toFixed(2)} (matches payment)` };
        }
      }
    }

    // 3) Buyer email exact match
    if (payment.buyer_email) {
      const target = payment.buyer_email.trim().toLowerCase();
      for (const c of clients) {
        if (c.email && c.email.trim().toLowerCase() === target) {
          ensure(c).signals.email = { reason: `Buyer email match (${c.email})` };
        }
      }
    }

    // 4) Name match via nearby unmatched Square customers
    if (token && unmatchedCustomerIds.size > 0) {
      const ids = Array.from(unmatchedCustomerIds).slice(0, 30);
      const infos = await Promise.all(
        ids.map(async (id) => ({ id, info: await fetchCustomer(token, id) })),
      );
      const apptById = new Map<string, string>();
      for (const b of bookings) {
        if (b.customer_id && b.start_at && !apptById.has(b.customer_id)) {
          apptById.set(b.customer_id, b.start_at);
        }
      }
      for (const { id, info } of infos) {
        if (!info) continue;
        const full = normName(`${info.given_name ?? ""}${info.family_name ?? ""}`);
        if (!full) continue;
        for (const c of clients) {
          const cf = normName(`${c.first_name}${c.last_name}`);
          if (cf && cf === full) {
            const apptAt = apptById.get(id) ?? null;
            const sameDay = apptAt ? isSameDay(new Date(apptAt).getTime(), paymentTs) : false;
            const label = `${info.given_name ?? ""} ${info.family_name ?? ""}`.trim();
            const reason = apptAt
              ? `Name match on nearby booking (${label}${sameDay ? ", same day" : ""})`
              : `Name match (${label})`;
            const e = ensure(c);
            if (!e.signals.name || (sameDay && !e.signals.name.sameDay)) {
              e.signals.name = { reason, sameDay };
            }
          }
        }
      }
    }

    // Cross-credit: merge signals across duplicate client rows that share
    // normalized (name + phone). Keeps each row visible with the union of signals.
    const normPhone = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
    const groupKey = (c: ClientRow) => {
      const name = normName(`${c.first_name}${c.last_name}`);
      const phone = normPhone(c.phone);
      if (!name || !phone) return null;
      return `${name}|${phone}`;
    };
    const groups = new Map<string, Signals>();
    for (const { client, signals } of perClient.values()) {
      const k = groupKey(client);
      if (!k) continue;
      const merged: Signals = groups.get(k) ?? {};
      if (signals.email) merged.email = signals.email;
      if (signals.amount) merged.amount = signals.amount;
      if (signals.appt) {
        const rank = { within30: 3, within2h: 2, sameday: 1 } as const;
        if (!merged.appt || rank[signals.appt.tier] > rank[merged.appt.tier]) {
          merged.appt = signals.appt;
        }
      }
      if (signals.name) {
        if (!merged.name || (signals.name.sameDay && !merged.name.sameDay)) {
          merged.name = signals.name;
        }
      }
      groups.set(k, merged);
    }

    // Also include client rows that had no direct signal but belong to a
    // group with signals (so the "$360 owed" active row surfaces when its
    // duplicate linked row got the appointment signal).
    const inScope = new Map<string, { client: ClientRow; signals: Signals }>();
    for (const [id, entry] of perClient) inScope.set(id, entry);
    for (const c of clients) {
      const k = groupKey(c);
      if (!k) continue;
      const g = groups.get(k);
      if (!g) continue;
      if (!inScope.has(c.id)) inScope.set(c.id, { client: c, signals: {} });
    }

    // Compute final signals per row (own signals ∪ group signals), score, reasons
    const scoreSignals = (s: Signals): { score: number; reasons: string[] } => {
      let score = 0;
      const reasons: string[] = [];
      if (s.email) {
        score += 100;
        reasons.push(`+100 ${s.email.reason}`);
      }
      if (s.amount) {
        score += 60;
        reasons.push(`+60 ${s.amount.reason}`);
      }
      if (s.appt) {
        if (s.appt.tier === "within30") {
          score += 50;
          reasons.push(`+50 ${s.appt.reason}`);
        } else if (s.appt.tier === "within2h") {
          score += 20;
          reasons.push(`+20 ${s.appt.reason}`);
        } else {
          score += 15;
          reasons.push(`+15 ${s.appt.reason}`);
        }
      }
      if (s.name) {
        score += 40;
        reasons.push(`+40 ${s.name.reason}`);
        if (s.name.sameDay) {
          score += 20;
          reasons.push(`+20 Same-day name match bonus`);
        }
      }
      return { score, reasons };
    };

    const suggestions: PaymentMatchSuggestion[] = Array.from(inScope.values())
      .map(({ client, signals }) => {
        const k = groupKey(client);
        const merged: Signals = { ...signals };
        if (k) {
          const g = groups.get(k);
          if (g) {
            if (!merged.email && g.email) merged.email = g.email;
            if (!merged.amount && g.amount) merged.amount = g.amount;
            if (!merged.appt && g.appt) merged.appt = g.appt;
            if (!merged.name && g.name) merged.name = g.name;
          }
        }
        const { score, reasons } = scoreSignals(merged);
        const categoryCount =
          (merged.email ? 1 : 0) +
          (merged.amount ? 1 : 0) +
          (merged.appt ? 1 : 0) +
          (merged.name ? 1 : 0);
        return {
          client_id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          email: client.email,
          phone: client.phone,
          status: client.status,
          amount_owed: Math.max(
            0,
            Number(client.package_price ?? 0) - Number(client.amount_paid ?? 0),
          ),
          reasons,
          confidence: categoryCount,
          score,
          nearest_appointment_at: merged.appt?.apptAt ?? null,
          square_customer_id: client.square_customer_id,
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.last_name.localeCompare(b.last_name))
      .slice(0, 10);

    return { suggestions, note };
  });


export type RetryPaymentResult = {
  payment_row_id: string;
  square_payment_id: string;
  outcome: "applied" | "already_applied" | "blocked" | "no_client";
  applied_amount: number;
  reason?: string;
};

async function retryOnePayment(
  supabaseAdmin: SupabaseClient<Database>,
  paymentRowId: string,
): Promise<RetryPaymentResult> {
  const { data: payment, error: pErr } = await supabaseAdmin
    .from("square_payments")
    .select("id, square_payment_id, client_id, amount_cents, applied, status")
    .eq("id", paymentRowId)
    .single();
  if (pErr) throw pErr;

  // Already applied — just clear needs_review flag
  if (payment.applied) {
    await supabaseAdmin
      .from("square_payments")
      .update({ needs_review: false })
      .eq("id", payment.id);
    return {
      payment_row_id: payment.id,
      square_payment_id: payment.square_payment_id,
      outcome: "already_applied",
      applied_amount: 0,
      reason: "Payment was already applied",
    };
  }

  if (!payment.client_id) {
    return {
      payment_row_id: payment.id,
      square_payment_id: payment.square_payment_id,
      outcome: "no_client",
      applied_amount: 0,
      reason: "No matched client — use Resolve to link manually",
    };
  }

  // Existing activity guard — payment already recorded on client.
  // Fail closed on query error so we never skip idempotency silently.
  const { data: existingActivity, error: guardErr } = await supabaseAdmin
    .from("client_activities")
    .select("id")
    .eq("client_id", payment.client_id)
    .contains("metadata", { square_payment_id: payment.square_payment_id })
    .limit(1);
  if (guardErr) {
    console.error(
      `[payment-retry] Idempotency guard query failed for client=${payment.client_id} payment=${payment.square_payment_id}: ${guardErr.message ?? String(guardErr)}`,
    );
    throw guardErr;
  }
  if (existingActivity && existingActivity.length > 0) {
    await supabaseAdmin
      .from("square_payments")
      .update({ applied: true, needs_review: false })
      .eq("id", payment.id);
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_retry",
      client_id: payment.client_id,
      status: "skipped",
      action: "retry_already_recorded",
      message: `Retry: payment ${payment.square_payment_id} already recorded on client — marked resolved`,
    });
    return {
      payment_row_id: payment.id,
      square_payment_id: payment.square_payment_id,
      outcome: "already_applied",
      applied_amount: 0,
      reason: "Activity already exists for this Square payment",
    };
  }

  try {
    const result = await applyPaymentOnce(supabaseAdmin, {
      clientId: payment.client_id,
      squarePaymentId: payment.square_payment_id,
      amountCents: payment.amount_cents,
      matchMethod: "manual_retry",
      manualResolution: true,
    });

    await supabaseAdmin
      .from("square_payments")
      .update({ applied: true, needs_review: false })
      .eq("id", payment.id);
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_retry",
      client_id: payment.client_id,
      status: "success",
      action: result.alreadyApplied ? "retry_already_credited" : "retry_applied",
      message: result.alreadyApplied
        ? `Retry: payment ${payment.square_payment_id} already credited — flags reconciled`
        : `Retry: applied $${(payment.amount_cents / 100).toFixed(2)} for payment ${payment.square_payment_id}`,
    });
    return {
      payment_row_id: payment.id,
      square_payment_id: payment.square_payment_id,
      outcome: result.alreadyApplied ? "already_applied" : "applied",
      applied_amount: result.appliedAmount,
    };
  } catch (e) {
    const msg = (e as Error).message ?? "Unknown error";
    let hint = msg;
    if (/amount_paid.*exceed.*package_price/i.test(msg)) {
      hint = "Client package_price is $0 or lower than payment — set package price first";
    }
    await supabaseAdmin
      .from("square_payments")
      .update({ needs_review: true })
      .eq("id", payment.id);
    await supabaseAdmin.from("square_sync_log").insert({
      event_type: "manual.payment_retry",
      client_id: payment.client_id,
      status: "error",
      action: "retry_blocked",
      message: `Retry blocked for payment ${payment.square_payment_id}: ${hint}`,
    });
    return {
      payment_row_id: payment.id,
      square_payment_id: payment.square_payment_id,
      outcome: "blocked",
      applied_amount: 0,
      reason: hint,
    };
  }
}

export const retryApplyPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { payment_row_id: string }) => d)
  .handler(async ({ data }): Promise<RetryPaymentResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return retryOnePayment(supabaseAdmin, data.payment_row_id);
  });

// Batch size chosen for Cloudflare Workers 1000-subrequest / 30s limit.
// Each retryOnePayment uses ~4-6 Supabase subrequests, so 50/batch = ~250
// subrequests — well under cap with headroom for the count query and retries.
const RETRY_BATCH_SIZE = 50;
const RETRY_HARD_CAP = 500;

export const retryAllMatchedBlockedPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { offset?: number; batch_size?: number }) => d ?? {})
  .handler(async ({ data }): Promise<{
    results: RetryPaymentResult[];
    summary: { applied: number; already_applied: number; blocked: number; no_client: number };
    processed: number;
    total_matched: number;
    next_offset: number;
    done: boolean;
    batch_size: number;
  }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const offset = Math.max(0, data.offset ?? 0);
    const batchSize = Math.min(RETRY_BATCH_SIZE, Math.max(1, data.batch_size ?? RETRY_BATCH_SIZE));

    // Get total up to the hard cap so the UI can show "X of N".
    const { count: totalMatched, error: countErr } = await supabaseAdmin
      .from("square_payments")
      .select("id", { count: "exact", head: true })
      .eq("needs_review", true)
      .eq("applied", false)
      .not("client_id", "is", null);
    if (countErr) throw countErr;
    const total = Math.min(totalMatched ?? 0, RETRY_HARD_CAP);

    const { data: rows, error } = await supabaseAdmin
      .from("square_payments")
      .select("id")
      .eq("needs_review", true)
      .eq("applied", false)
      .not("client_id", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;

    const results: RetryPaymentResult[] = [];
    for (const r of rows ?? []) {
      try {
        results.push(await retryOnePayment(supabaseAdmin, r.id));
      } catch (e) {
        results.push({
          payment_row_id: r.id,
          square_payment_id: "",
          outcome: "blocked",
          applied_amount: 0,
          reason: (e as Error).message,
        });
      }
    }
    const summary = {
      applied: results.filter((r) => r.outcome === "applied").length,
      already_applied: results.filter((r) => r.outcome === "already_applied").length,
      blocked: results.filter((r) => r.outcome === "blocked").length,
      no_client: results.filter((r) => r.outcome === "no_client").length,
    };
    const processed = results.length;
    // "applied" rows leave the query set, so the next offset stays put for
    // those (they no longer appear). "blocked"/"already_applied" that still
    // match the filter would repeat — advance past them.
    const stillMatchedProcessed = results.filter(
      (r) => r.outcome === "blocked",
    ).length;
    const nextOffset = offset + stillMatchedProcessed;
    // done when this batch returned less than requested (no more rows)
    const done = processed < batchSize;

    return {
      results,
      summary,
      processed,
      total_matched: total,
      next_offset: nextOffset,
      done,
      batch_size: batchSize,
    };
  });
