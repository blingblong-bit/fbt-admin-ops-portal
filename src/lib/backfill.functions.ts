import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

type SquareCustomer = {
  id: string;
  given_name?: string | null;
  family_name?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  company_name?: string | null;
  nickname?: string | null;
};

type SquareBooking = {
  id: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
};

export type BackfillResult = {
  fetched_customers: number;
  fetched_bookings: number;
  auto_linked: number;
  updated_contact: number;
  queued_for_review: number;
  skipped_already_linked: number;
  skipped_deleted: number;
  errors: string[];
};

function cleanToken(t: string | undefined | null): string {
  return (t ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

function normEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return t || null;
}

function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  // Keep last 10 digits to ignore country code variance
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function squareGet<T>(
  token: string,
  url: string,
): Promise<{ ok: boolean; json?: T; error?: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Square ${res.status}: ${body.slice(0, 300)}` };
  }
  return { ok: true, json: (await res.json()) as T };
}

async function fetchAllCustomers(
  token: string,
): Promise<{ customers: SquareCustomer[]; error: string | null }> {
  const all: SquareCustomer[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const url = new URL(`${SQUARE_BASE}/v2/customers`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sort_field", "CREATED_AT");
    url.searchParams.set("sort_order", "DESC");
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await squareGet<{ customers?: SquareCustomer[]; cursor?: string }>(
      token,
      url.toString(),
    );
    if (!r.ok) return { customers: all, error: r.error ?? "Square error" };
    if (r.json?.customers?.length) all.push(...r.json.customers);
    cursor = r.json?.cursor;
    if (!cursor) break;
  }
  return { customers: all, error: null };
}

async function fetchFutureBookings(token: string): Promise<Set<string>> {
  const out = new Set<string>();
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${SQUARE_BASE}/v2/bookings`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("start_at_min", now.toISOString());
    url.searchParams.set("start_at_max", end.toISOString());
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await squareGet<{ bookings?: SquareBooking[]; cursor?: string }>(
      token,
      url.toString(),
    );
    if (!r.ok) break;
    for (const b of r.json?.bookings ?? []) {
      if (!b.customer_id) continue;
      if (b.status && /(CANCELLED|DECLINED|NO_SHOW)/i.test(b.status)) continue;
      out.add(b.customer_id);
    }
    cursor = r.json?.cursor;
    if (!cursor) break;
  }
  return out;
}

export const backfillProductionCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackfillResult> => {
    const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
    const result: BackfillResult = {
      fetched_customers: 0,
      fetched_bookings: 0,
      auto_linked: 0,
      updated_contact: 0,
      queued_for_review: 0,
      skipped_already_linked: 0,
      skipped_deleted: 0,
      errors: [],
    };
    if (!token) {
      result.errors.push("SQUARE_PRODUCTION_ACCESS_TOKEN not configured");
      return result;
    }

    const [{ customers, error: cErr }, futureCustomerIds] = await Promise.all([
      fetchAllCustomers(token),
      fetchFutureBookings(token),
    ]);
    if (cErr) result.errors.push(cErr);
    result.fetched_customers = customers.length;
    result.fetched_bookings = futureCustomerIds.size;

    const { data: existing, error: eErr } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, email, phone, square_customer_id, deleted_at, status");
    if (eErr) throw eErr;

    const bySquareId = new Map<string, NonNullable<typeof existing>[number]>();
    const byEmail = new Map<string, NonNullable<typeof existing>[number][]>();
    const byPhone = new Map<string, NonNullable<typeof existing>[number][]>();
    const byName = new Map<string, NonNullable<typeof existing>[number][]>();
    for (const c of existing ?? []) {
      if (c.deleted_at) continue;
      if (c.square_customer_id) bySquareId.set(c.square_customer_id, c);
      const em = normEmail(c.email);
      if (em) {
        const arr = byEmail.get(em) ?? [];
        arr.push(c);
        byEmail.set(em, arr);
      }
      const ph = normPhone(c.phone);
      if (ph) {
        const arr = byPhone.get(ph) ?? [];
        arr.push(c);
        byPhone.set(ph, arr);
      }
      const nm = `${(c.first_name ?? "").trim().toLowerCase()} ${(c.last_name ?? "").trim().toLowerCase()}`.trim();
      if (nm) {
        const arr = byName.get(nm) ?? [];
        arr.push(c);
        byName.set(nm, arr);
      }
    }

    // Existing pending reviews — used to avoid duplicates
    const { data: existingReviews } = await context.supabase
      .from("square_customer_reviews")
      .select("square_customer_id, status");
    const reviewStatusById = new Map<string, string>();
    for (const r of existingReviews ?? []) {
      reviewStatusById.set(r.square_customer_id, r.status);
    }

    for (const cust of customers) {
      try {
        const sqEmail = normEmail(cust.email_address);
        const sqPhone = normPhone(cust.phone_number);
        const first = (cust.given_name ?? cust.nickname ?? "").trim();
        const last = (cust.family_name ?? cust.company_name ?? "").trim();
        const nameKey = `${first.toLowerCase()} ${last.toLowerCase()}`.trim();

        const linked = bySquareId.get(cust.id);

        // Case 1: already linked — only refresh contact fields
        if (linked) {
          if (linked.deleted_at) {
            result.skipped_deleted++;
            continue;
          }
          const update: { email?: string; phone?: string } = {};
          if (cust.email_address && !linked.email) update.email = cust.email_address;
          if (cust.phone_number && !linked.phone) update.phone = cust.phone_number;
          if (Object.keys(update).length > 0) {
            await context.supabase.from("clients").update(update).eq("id", linked.id);
            result.updated_contact++;
          } else {
            result.skipped_already_linked++;
          }
          continue;
        }

        // Case 2/3/4: try high-confidence auto-link
        const emailMatches = sqEmail ? byEmail.get(sqEmail) ?? [] : [];
        const phoneMatches = sqPhone ? byPhone.get(sqPhone) ?? [] : [];

        // Unique IDs from each match set
        const emailIds = new Set(emailMatches.map((c) => c.id));
        const phoneIds = new Set(phoneMatches.map((c) => c.id));
        const bothIds = [...emailIds].filter((id) => phoneIds.has(id));

        let autoLinkClient: (typeof emailMatches)[number] | null = null;
        let confidence = "";

        if (bothIds.length === 1) {
          autoLinkClient = emailMatches.find((c) => c.id === bothIds[0]) ?? null;
          confidence = "email + phone exact match";
        } else if (emailIds.size === 1 && phoneIds.size <= 1) {
          // Email is unique; phone either matches none or the same client
          const candidate = emailMatches[0];
          if (phoneIds.size === 0 || phoneIds.has(candidate.id)) {
            autoLinkClient = candidate;
            confidence = "exact email match";
          }
        } else if (emailIds.size === 0 && phoneIds.size === 1) {
          autoLinkClient = phoneMatches[0];
          confidence = "exact phone match";
        }

        if (autoLinkClient) {
          // Make sure this client isn't already linked to a different Square customer
          if (autoLinkClient.square_customer_id && autoLinkClient.square_customer_id !== cust.id) {
            // Conflict — fall through to review queue
          } else {
            const update: { square_customer_id: string; email?: string; phone?: string } = {
              square_customer_id: cust.id,
            };
            if (cust.email_address && !autoLinkClient.email) update.email = cust.email_address;
            if (cust.phone_number && !autoLinkClient.phone) update.phone = cust.phone_number;
            const { error: uErr } = await context.supabase
              .from("clients")
              .update(update)
              .eq("id", autoLinkClient.id);
            if (uErr) throw uErr;
            await context.supabase.from("client_activities").insert({
              client_id: autoLinkClient.id,
              activity_type: "square_link",
              description: `Linked to Square customer (${confidence})`,
              metadata: { square_customer_id: cust.id, confidence },
            });
            // Update local index so subsequent customers don't double-link
            bySquareId.set(cust.id, { ...autoLinkClient, square_customer_id: cust.id });
            result.auto_linked++;
            continue;
          }
        }

        // Needs review — figure out reason + suggestion
        let reason = "unmatched";
        let suggestedId: string | null = null;

        const allCandidateIds = new Set<string>([...emailIds, ...phoneIds]);
        if (allCandidateIds.size > 1) {
          reason = "multiple possible matches";
        } else if (allCandidateIds.size === 1) {
          // Single candidate but ambiguous (e.g. email matched but phone conflicts on the other side)
          const onlyId = [...allCandidateIds][0];
          suggestedId = onlyId;
          if (emailIds.size === 1 && phoneIds.size === 1 && bothIds.length === 0) {
            reason = "email and phone match different clients";
          } else {
            const c = (emailMatches.concat(phoneMatches)).find((x) => x.id === onlyId);
            if (c?.square_customer_id) reason = "candidate already linked to another Square customer";
            else reason = "partial contact match";
          }
        } else if (!sqEmail && !sqPhone) {
          reason = "missing email and phone";
          // Name-only suggestion
          if (nameKey) {
            const nm = byName.get(nameKey) ?? [];
            if (nm.length === 1) {
              suggestedId = nm[0].id;
              reason = "name-only match (no email/phone)";
            } else if (nm.length > 1) {
              reason = "duplicate names";
            }
          }
        } else {
          // No email/phone match — try name suggestion only
          if (nameKey) {
            const nm = byName.get(nameKey) ?? [];
            if (nm.length === 1) {
              suggestedId = nm[0].id;
              reason = "name-only match";
            } else if (nm.length > 1) {
              reason = "duplicate names";
            }
          }
        }

        const prior = reviewStatusById.get(cust.id);
        if (prior === "ignored" || prior === "linked" || prior === "created") {
          // Respect previous staff decision
          continue;
        }

        await context.supabase
          .from("square_customer_reviews")
          .upsert(
            {
              square_customer_id: cust.id,
              given_name: first || null,
              family_name: last || null,
              email: cust.email_address ?? null,
              phone: cust.phone_number ?? null,
              suggested_client_id: suggestedId,
              reason,
              status: "pending",
            },
            { onConflict: "square_customer_id" },
          );
        result.queued_for_review++;
      } catch (e) {
        result.errors.push(`${cust.id}: ${(e as Error).message}`);
      }
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("square_sync_log").insert({
        event_type: "customer.backfill",
        status: result.errors.length ? "partial" : "success",
        action: "production_backfill",
        message: `Backfill: fetched=${result.fetched_customers} auto_linked=${result.auto_linked} review=${result.queued_for_review} updated=${result.updated_contact} errors=${result.errors.length}`,
      });
    } catch {
      // ignore logging errors
    }

    return result;
  });

export type SquareCustomerReview = {
  id: string;
  square_customer_id: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone: string | null;
  suggested_client_id: string | null;
  reason: string;
  status: string;
  created_at: string;
  suggested_client: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
  } | null;
};

export const listSquareCustomerReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SquareCustomerReview[]> => {
    const { data, error } = await context.supabase
      .from("square_customer_reviews")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const reviews = data ?? [];

    const ids = Array.from(
      new Set(reviews.map((r) => r.suggested_client_id).filter((x): x is string => !!x)),
    );
    let suggestedMap = new Map<
      string,
      { id: string; first_name: string; last_name: string; email: string | null; phone: string | null }
    >();
    if (ids.length > 0) {
      const { data: cs } = await context.supabase
        .from("clients")
        .select("id, first_name, last_name, email, phone")
        .in("id", ids);
      for (const c of cs ?? []) suggestedMap.set(c.id, c);
    }

    return reviews.map((r) => ({
      ...r,
      suggested_client: r.suggested_client_id ? suggestedMap.get(r.suggested_client_id) ?? null : null,
    })) as SquareCustomerReview[];
  });

export const linkSquareReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string; clientId: string }) => {
    if (!d?.reviewId) throw new Error("reviewId required");
    if (!d?.clientId) throw new Error("clientId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: review, error: rErr } = await context.supabase
      .from("square_customer_reviews")
      .select("square_customer_id, email, phone")
      .eq("id", data.reviewId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!review) throw new Error("Review not found");

    // Guard: don't double-link the same Square customer to two Admin clients
    const { data: other } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name")
      .eq("square_customer_id", review.square_customer_id)
      .is("deleted_at", null)
      .neq("id", data.clientId)
      .maybeSingle();
    if (other) {
      throw new Error(
        `Square customer already linked to ${other.first_name} ${other.last_name}`,
      );
    }

    const { data: client } = await context.supabase
      .from("clients")
      .select("email, phone")
      .eq("id", data.clientId)
      .maybeSingle();

    const update: { square_customer_id: string; email?: string; phone?: string } = {
      square_customer_id: review.square_customer_id,
    };
    if (review.email && !client?.email) update.email = review.email;
    if (review.phone && !client?.phone) update.phone = review.phone;

    const { error: uErr } = await context.supabase
      .from("clients")
      .update(update)
      .eq("id", data.clientId);
    if (uErr) throw uErr;

    await context.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "square_link",
      description: "Linked to Square customer (manual review)",
      metadata: { square_customer_id: review.square_customer_id, source: "review_queue" },
    });

    await context.supabase
      .from("square_customer_reviews")
      .update({ status: "linked" })
      .eq("id", data.reviewId);

    return { ok: true };
  });

export const createClientFromSquareReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string }) => {
    if (!d?.reviewId) throw new Error("reviewId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: review, error: rErr } = await context.supabase
      .from("square_customer_reviews")
      .select("*")
      .eq("id", data.reviewId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!review) throw new Error("Review not found");

    const first = (review.given_name ?? "").trim() || "(Unknown)";
    const last = (review.family_name ?? "").trim() || "(Unknown)";

    const { data: created, error: iErr } = await context.supabase
      .from("clients")
      .insert({
        first_name: first,
        last_name: last,
        email: review.email,
        phone: review.phone,
        square_customer_id: review.square_customer_id,
        status: "assessment",
        package_total_visits: 0,
        package_price: 0,
        amount_paid: 0,
        internal_notes: "Created from Square review queue",
      })
      .select("id")
      .single();
    if (iErr) throw iErr;

    await context.supabase.from("client_activities").insert({
      client_id: created.id,
      activity_type: "square_link",
      description: "Client created from Square review queue and linked",
      metadata: { square_customer_id: review.square_customer_id },
    });

    await context.supabase
      .from("square_customer_reviews")
      .update({ status: "created" })
      .eq("id", data.reviewId);

    return { ok: true, client_id: created.id };
  });

export const ignoreSquareReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewId: string }) => {
    if (!d?.reviewId) throw new Error("reviewId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("square_customer_reviews")
      .update({ status: "ignored" })
      .eq("id", data.reviewId);
    if (error) throw error;
    return { ok: true };
  });
