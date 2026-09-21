import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildBalanceDraft,
  buildRenewalDraft,
  draftChanged,
  type DraftPlan,
  type DuesClient,
  type DuesMessage,
} from "@/lib/dues-messaging";
import { fullName, totalOwed } from "@/lib/clients";
import {
  buildDuesTextsBoard,
  type BoardCard,
  type DuesTextsBoard,
} from "@/lib/dues-texts-board";

type Ctx = { supabase: any; userId: string };

async function assertAdmin(context: Ctx) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superadmin" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("Forbidden — admin access required");
}

const CLIENT_COLUMNS =
  "id, first_name, last_name, phone, package_name, package_total_visits, package_price, package_start_date, visits_used, amount_paid, previous_package_owed, payment_model, status, deleted_at, pending_renewal_start_date, pending_renewal_price, pending_renewal_total_visits, pending_renewal_package_name, pending_renewal_paid, sms_consent_at, sms_consent_source, sms_consent_recorded_by, sms_opted_out_at, sms_opt_out_source";

/** Non-secret: lets the UI render the "sending disabled" banner. */
export const getMessagingFlag = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ sendingEnabled: boolean }> => ({
    sendingEnabled: process.env["SMS_DUES_SENDING_ENABLED"] === "true",
  }));

/** Staff-readable message history (all, or for one client). */
export const listDuesMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId?: string } | undefined) => ({ clientId: d?.clientId }))
  .handler(async ({ data, context }): Promise<{ messages: DuesMessage[] }> => {
    let q = context.supabase
      .from("dues_messages")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { messages: (rows ?? []) as DuesMessage[] };
  });

export type DuesQueueRow = {
  client: DuesClient & { package_start_date: string | null };
  current_owed: number;
  previous_owed: number;
  total_owed: number;
  last_message: DuesMessage | null;
};

async function loadEligibleClients(context: Ctx) {
  const { data: rows, error } = await context.supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .is("deleted_at", null);
  if (error) throw error;
  return (rows ?? []) as (DuesClient & { package_start_date: string | null })[];
}

async function loadDismissedIds(context: Ctx): Promise<Set<string>> {
  const { data } = await context.supabase
    .from("client_activities")
    .select("client_id, activity_type")
    .in("activity_type", ["package_review_dismissed", "package_review_undismissed"])
    .order("created_at", { ascending: true });
  const set = new Set<string>();
  for (const a of (data ?? []) as { client_id: string; activity_type: string }[]) {
    if (a.activity_type === "package_review_dismissed") set.add(a.client_id);
    else set.delete(a.client_id);
  }
  return set;
}

export const getDuesQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: DuesQueueRow[] }> => {
    await assertAdmin(context as unknown as Ctx);
    const ctx = context as unknown as Ctx;
    const [clients, dismissed] = await Promise.all([
      loadEligibleClients(ctx),
      loadDismissedIds(ctx),
    ]);
    const { isDuesQueueEligible, currentBalanceOwed, priorBalanceOwed } = await import(
      "@/lib/dues-messaging"
    );
    const eligible = clients.filter((c) => isDuesQueueEligible(c, dismissed.has(c.id)));

    const { data: msgs } = await ctx.supabase
      .from("dues_messages")
      .select("*")
      .in(
        "client_id",
        eligible.map((c) => c.id),
      )
      .order("created_at", { ascending: false });
    const latest = new Map<string, DuesMessage>();
    for (const m of (msgs ?? []) as DuesMessage[]) {
      if (!latest.has(m.client_id)) latest.set(m.client_id, m);
    }

    return {
      rows: eligible.map((c) => ({
        client: c,
        current_owed: currentBalanceOwed(c),
        previous_owed: priorBalanceOwed(c),
        total_owed: totalOwed(c),
        last_message: latest.get(c.id) ?? null,
      })),
    };
  });

/**
 * Re-derives this client's unsent balance/renewal drafts from their current
 * record and rewrites blocked / warnings / wording / amount in place. Used
 * after a state change (e.g. consent recorded) that can make a stored draft's
 * blocking reason obsolete.
 */
async function revalidateOpenDrafts(context: Ctx, client: DuesClient): Promise<void> {
  const { data } = await context.supabase
    .from("dues_messages")
    .select("id, message_type")
    .eq("client_id", client.id)
    .eq("status", "ready_not_sent")
    .in("message_type", ["balance_due", "renewal_due"]);
  const rows = (data ?? []) as { id: string; message_type: string }[];
  if (rows.length === 0) return;

  const dismissed = await loadDismissedIds(context);
  const isDismissed = dismissed.has(client.id);
  for (const row of rows) {
    const plan =
      row.message_type === "renewal_due"
        ? buildRenewalDraft(client, isDismissed)
        : buildBalanceDraft(client, isDismissed);
    await context.supabase
      .from("dues_messages")
      .update({
        body: plan.body,
        amount_due: plan.amountDue,
        validation_warnings: plan.warnings,
        blocked: plan.blocked,
      })
      .eq("id", row.id);
  }
}

/**
 * Idempotent draft upsert. Reuses the unsent draft for the same obligation,
 * rebuilds its wording/amount from current records, and only writes an
 * activity row on creation or a material change.
 */
export async function upsertDraft(
  context: Ctx,
  plan: DraftPlan,
  triggerSource: string,
): Promise<{ created: boolean; changed: boolean }> {
  // One obligation can need more than one draft over time: once a draft is
  // closed (payment received) or sent, a later Pre-Renew for the same client
  // must be able to start a fresh one. Drafts for the same obligation share a
  // base key and are distinguished by a `#n` generation suffix.
  const baseKey = plan.requestKey;
  const { data: history } = await context.supabase
    .from("dues_messages")
    .select("*")
    .like("request_key", `${baseKey}%`)
    .order("created_at", { ascending: false });

  const siblings = ((history ?? []) as DuesMessage[]).filter(
    (m) => m.request_key === baseKey || m.request_key.startsWith(`${baseKey}#`),
  );
  const existing = siblings.find((m) => m.status === "ready_not_sent") ?? null;
  const requestKey = existing
    ? existing.request_key
    : siblings.length === 0
      ? baseKey
      : `${baseKey}#${siblings.length}`;

  const row = {
    client_id: plan.clientId,
    phone: plan.phone,
    message_type: plan.messageType,
    direction: "outbound",
    package_start_date: plan.packageStartDate,
    amount_due: plan.amountDue,
    body: plan.body,
    trigger_source: triggerSource,
    validation_warnings: plan.warnings,
    blocked: plan.blocked,
    request_key: requestKey,
  };

  if (!existing) {
    // A follow-up generation is only worth drafting when money is actually due;
    // otherwise a settled obligation would spawn a new draft on every refresh.
    if (siblings.length > 0 && !(plan.amountDue > 0)) {
      return { created: false, changed: false };
    }
    const { error } = await context.supabase
      .from("dues_messages")
      .insert({ ...row, status: "ready_not_sent" });
    if (error) throw error;
    await context.supabase.from("client_activities").insert({
      client_id: plan.clientId,
      activity_type: "dues_message_draft_created",
      description: `Dues message drafted (${plan.messageType === "renewal_due" ? "renewal" : plan.messageType === "consent_confirmation" ? "opt-in confirmation" : "balance"}) — not sent.`,
      metadata: { request_key: requestKey, amount_due: plan.amountDue, blocked: plan.blocked },
    });
    return { created: true, changed: true };
  }

  const prior = existing as DuesMessage;

  const changed = draftChanged(prior, plan);
  if (!changed) return { created: false, changed: false };

  const { error } = await context.supabase
    .from("dues_messages")
    .update(row)
    .eq("id", prior.id);
  if (error) throw error;
  await context.supabase.from("client_activities").insert({
    client_id: plan.clientId,
    activity_type: "dues_message_draft_updated",
    description: "Dues message draft updated from current records — not sent.",
    metadata: { request_key: requestKey, amount_due: plan.amountDue, blocked: plan.blocked },
  });
  return { created: false, changed: true };
}

export type GenerateResult = {
  created: number;
  updated: number;
  closed: number;
  total: number;
};

/** Acceptance-test mode forces every generation call to be scoped to test records. */
export function acceptanceTestMode(): boolean {
  return process.env["DUES_ACCEPTANCE_TEST_MODE"] === "true";
}

export const TEST_CLIENT_PREFIX = "ZZTEST";

function isTestRecord(c: { first_name?: string | null; last_name?: string | null }): boolean {
  return (
    (c.first_name ?? "").startsWith(TEST_CLIENT_PREFIX) ||
    (c.last_name ?? "").startsWith(TEST_CLIENT_PREFIX)
  );
}

/**
 * Rebuild drafts for the current queue + prepared renewals. Nothing sends.
 *
 * Fail-closed: while acceptance-test mode is on, this refuses to run unless it
 * is handed a non-empty `clientIds` list where every ID resolves to a
 * disposable ZZTEST record. It throws before any read or write, so a forgotten
 * argument can never fan out across real clients.
 */
export async function runGenerateDuesPreviews(
  ctx: Ctx,
  opts: { clientIds?: string[] | null } = {},
): Promise<GenerateResult> {
  const scope = opts.clientIds ?? null;
  const testMode = acceptanceTestMode();

  if (testMode && (!scope || scope.length === 0)) {
    throw new Error(
      "Acceptance-test mode: generateDuesPreviews requires a non-empty clientIds scope",
    );
  }

  const [allClients, dismissed] = await Promise.all([
    loadEligibleClients(ctx),
    loadDismissedIds(ctx),
  ]);

  let clients = allClients;
  if (scope && scope.length > 0) {
    const wanted = new Set(scope);
    clients = allClients.filter((c) => wanted.has(c.id));
    if (testMode) {
      if (clients.length !== wanted.size) {
        throw new Error("Acceptance-test mode: clientIds contains unknown client IDs");
      }
      const contaminated = clients.filter((c) => !isTestRecord(c));
      if (contaminated.length > 0) {
        throw new Error(
          "Acceptance-test mode: clientIds contains non-test client IDs — refusing to write",
        );
      }
    }
  }

  const { isDuesQueueEligible } = await import("@/lib/dues-messaging");

  let created = 0;
  let updated = 0;

  for (const c of clients) {
    const isDismissed = dismissed.has(c.id);
    if (c.pending_renewal_start_date) {
      const r = await upsertDraft(ctx, buildRenewalDraft(c, isDismissed), "pre_renew");
      if (r.created) created++;
      else if (r.changed) updated++;
    }
    if (isDuesQueueEligible(c, isDismissed)) {
      const r = await upsertDraft(ctx, buildBalanceDraft(c, isDismissed), "dues_queue");
      if (r.created) created++;
      else if (r.changed) updated++;
    }
  }

  // Obligations paid before sending: close the unsent draft for good.
  let openQuery = ctx.supabase
    .from("dues_messages")
    .select("id, client_id, message_type, request_key")
    .eq("status", "ready_not_sent");
  if (scope && scope.length > 0) openQuery = openQuery.in("client_id", scope);
  const { data: openDrafts } = await openQuery;
  const byId = new Map(clients.map((c) => [c.id, c]));
  let closed = 0;
  for (const d of (openDrafts ?? []) as Pick<
    DuesMessage,
    "id" | "client_id" | "message_type" | "request_key"
  >[]) {
    const c = byId.get(d.client_id);
    if (!c) continue;
    // Opt-in confirmations carry no amount and are never retired by a payment.
    if (d.message_type === "consent_confirmation") continue;
    const stillOwed =
      d.message_type === "renewal_due"
        ? Math.max(
            0,
            Number(c.pending_renewal_price ?? 0) - Number(c.pending_renewal_paid ?? 0),
          ) > 0 && !!c.pending_renewal_start_date
        : totalOwed(c) > 0;
    if (stillOwed) continue;
    await ctx.supabase
      .from("dues_messages")
      .update({ status: "payment_received" })
      .eq("id", d.id);
    await ctx.supabase.from("client_activities").insert({
      client_id: d.client_id,
      activity_type: "dues_message_payment_received",
      description: "Balance settled before the dues message was sent — draft closed.",
      metadata: { request_key: d.request_key },
    });
    closed++;
  }

  const { count } = await ctx.supabase
    .from("dues_messages")
    .select("id", { count: "exact", head: true });
  return { created, updated, closed, total: count ?? 0 };
}

export const generateDuesPreviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientIds?: string[] } | undefined) => ({
    clientIds: d?.clientIds ?? null,
  }))
  .handler(async ({ context, data }): Promise<GenerateResult> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    return runGenerateDuesPreviews(ctx, { clientIds: data.clientIds });
  });

/* ------------------------------------------------------------------ */
/* Consent capture                                                      */
/* ------------------------------------------------------------------ */

async function loadClient(ctx: Ctx, clientId: string) {
  const { data, error } = await ctx.supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Client not found");
  return data as DuesClient & { package_start_date: string | null };
}

/**
 * Staff/admin records affirmative verbal consent and the opt-in confirmation
 * draft is created in the same step. Nothing is sent.
 */
export const recordSmsConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId) throw new Error("clientId is required");
    return { clientId: d.clientId };
  })
  .handler(async ({ data, context }): Promise<{ consentAt: string }> => {
    const ctx = context as unknown as Ctx;
    const consentAt = new Date().toISOString();
    const { error } = await ctx.supabase
      .from("clients")
      .update({
        sms_consent_at: consentAt,
        sms_consent_source: "in_person_verbal",
        sms_consent_recorded_by: ctx.userId,
        sms_opted_out_at: null,
        sms_opt_out_source: null,
      })
      .eq("id", data.clientId);
    if (error) throw error;

    await ctx.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "sms_consent_recorded",
      description: "SMS consent recorded (in person, verbal).",
      metadata: { source: "in_person_verbal", recorded_by: ctx.userId, consent_at: consentAt },
    });

    const client = await loadClient(ctx, data.clientId);
    const { buildConsentConfirmationDraft } = await import("@/lib/dues-messaging");
    await upsertDraft(ctx, buildConsentConfirmationDraft(client), "consent_recorded");

    // Drafts written before consent existed still carry
    // "Blocked — SMS consent not recorded". Re-derive them from the client's
    // current state so they become sendable without a queue rebuild.
    await revalidateOpenDrafts(ctx, client);

    return { consentAt };
  });

export const markSmsOptedOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; source?: string }) => {
    if (!d?.clientId) throw new Error("clientId is required");
    return { clientId: d.clientId, source: d.source ?? "staff_verbal" };
  })
  .handler(async ({ data, context }): Promise<{ optedOutAt: string }> => {
    const ctx = context as unknown as Ctx;
    const optedOutAt = new Date().toISOString();
    const { error } = await ctx.supabase
      .from("clients")
      .update({ sms_opted_out_at: optedOutAt, sms_opt_out_source: data.source })
      .eq("id", data.clientId);
    if (error) throw error;
    await ctx.supabase.from("client_activities").insert({
      client_id: data.clientId,
      activity_type: "sms_opted_out",
      description: "Client opted out of text messages.",
      metadata: { source: data.source, opted_out_at: optedOutAt },
    });
    // Any unsent draft for this client is now unsendable.
    await ctx.supabase
      .from("dues_messages")
      .update({
        blocked: true,
        validation_warnings: ["Client opted out of texts"],
      })
      .eq("client_id", data.clientId)
      .eq("status", "ready_not_sent");
    return { optedOutAt };
  });

export type EligibilityCounts = {
  consented: number;
  not_consented: number;
  opted_out: number;
  invalid_phone: number;
};

export const getSmsEligibilityCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EligibilityCounts> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const clients = await loadEligibleClients(ctx);
    const { smsEligibility } = await import("@/lib/dues-messaging");
    const counts: EligibilityCounts = {
      consented: 0,
      not_consented: 0,
      opted_out: 0,
      invalid_phone: 0,
    };
    for (const c of clients) {
      if (c.status === "archived") continue;
      counts[smsEligibility(c)]++;
    }
    return counts;
  });

/* ------------------------------------------------------------------ */
/* Manual Send Now                                                      */
/* ------------------------------------------------------------------ */

/**
 * Re-validates everything from live records, then hands the draft to the only
 * module allowed to talk to Twilio. Validation branches by message type: an
 * opt-in confirmation never depends on an amount owed.
 */
export const sendDuesMessageNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => {
    if (!d?.messageId) throw new Error("messageId is required");
    return { messageId: d.messageId };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ sent: boolean; reason?: string; sid?: string }> => {
      const ctx = context as unknown as Ctx;
      await assertAdmin(ctx);

      const { data: row, error } = await ctx.supabase
        .from("dues_messages")
        .select("*")
        .eq("id", data.messageId)
        .maybeSingle();
      if (error) throw error;
      if (!row) throw new Error("Message not found");
      const draft = row as DuesMessage;

      if (draft.status !== "ready_not_sent") {
        return { sent: false, reason: `This message is already ${draft.status}.` };
      }
      if (draft.twilio_sid) {
        return { sent: false, reason: "This message has already been sent." };
      }

      const client = await loadClient(ctx, draft.client_id);
      const dismissed = await loadDismissedIds(ctx);
      const {
        buildBalanceDraft,
        buildRenewalDraft,
        buildConsentConfirmationDraft,
        isSendable,
      } = await import("@/lib/dues-messaging");
      const isDismissed = dismissed.has(client.id);

      const fresh =
        draft.message_type === "renewal_due"
          ? buildRenewalDraft(client, isDismissed)
          : draft.message_type === "consent_confirmation"
            ? buildConsentConfirmationDraft(client)
            : buildBalanceDraft(client, isDismissed);

      // Obligation settled before sending — close it instead.
      if (fresh.messageType !== "consent_confirmation" && !(fresh.amountDue > 0)) {
        await ctx.supabase
          .from("dues_messages")
          .update({ status: "payment_received" })
          .eq("id", draft.id);
        await ctx.supabase.from("client_activities").insert({
          client_id: client.id,
          activity_type: "dues_message_payment_received",
          description: "Balance settled before the dues message was sent — draft closed.",
          metadata: { request_key: draft.request_key },
        });
        return { sent: false, reason: "Nothing is owed any more — the draft was closed." };
      }

      // Amount or wording moved since the draft was reviewed: rewrite and ask again.
      const amountChanged = Number(draft.amount_due) !== Number(fresh.amountDue);
      if (amountChanged || draft.body !== fresh.body || draft.blocked !== fresh.blocked) {
        await ctx.supabase
          .from("dues_messages")
          .update({
            amount_due: fresh.amountDue,
            body: fresh.body,
            blocked: fresh.blocked,
            validation_warnings: fresh.warnings,
            phone: fresh.phone,
          })
          .eq("id", draft.id);
        return {
          sent: false,
          reason: "The details changed since this was drafted — review the new text and confirm again.",
        };
      }

      if (!isSendable({ status: draft.status, blocked: fresh.blocked })) {
        return { sent: false, reason: fresh.warnings.join("; ") || "Message is blocked." };
      }

      // A consented client never receives a dues text before their confirmation.
      if (draft.message_type !== "consent_confirmation") {
        const { data: pendingConfirm } = await ctx.supabase
          .from("dues_messages")
          .select("id")
          .eq("client_id", client.id)
          .eq("message_type", "consent_confirmation")
          .eq("status", "ready_not_sent")
          .limit(1);
        if ((pendingConfirm ?? []).length > 0) {
          return {
            sent: false,
            reason:
              "Send this client's opt-in confirmation first — it has not gone out yet.",
          };
        }
      }

      const { sendDuesMessage } = await import("@/lib/dues-sms.server");
      try {
        const result = await sendDuesMessage({
          id: draft.id,
          phone: fresh.phone,
          body: fresh.body,
          status: draft.status,
          blocked: fresh.blocked,
        });
        await ctx.supabase
          .from("dues_messages")
          .update({
            status: "sent",
            twilio_sid: result.sid,
            sent_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
          })
          .eq("id", draft.id);
        await ctx.supabase.from("client_activities").insert({
          client_id: client.id,
          activity_type: "dues_message_sent",
          description: "Dues text message sent.",
          metadata: { request_key: draft.request_key, twilio_sid: result.sid },
        });
        return { sent: true, sid: result.sid };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await ctx.supabase
          .from("dues_messages")
          .update({ error_message: message.slice(0, 500) })
          .eq("id", draft.id);
        throw new Error(message);
      }
    },
  );

/* ------------------------------------------------------------------ */
/* Dues Texts operational board                                         */
/* ------------------------------------------------------------------ */

/**
 * One admin view of everything actionable: ready, blocked, recently sent and
 * closed-by-payment. Draft rows are re-derived from live client state so a
 * stale stored row can never make something look sendable.
 */
export const getDuesTextsBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DuesTextsBoard> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);

    const { data: msgs, error } = await ctx.supabase
      .from("dues_messages")
      .select("*")
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (msgs ?? []) as DuesMessage[];
    if (rows.length === 0) return buildDuesTextsBoard([]);

    const ids = [...new Set(rows.map((r) => r.client_id))];
    const { data: clientRows } = await ctx.supabase
      .from("clients")
      .select(CLIENT_COLUMNS)
      .in("id", ids);
    const byId = new Map(
      ((clientRows ?? []) as (DuesClient & { package_start_date: string | null })[]).map((c) => [
        c.id,
        c,
      ]),
    );
    const dismissed = await loadDismissedIds(ctx);
    const { smsEligibility, buildConsentConfirmationDraft } = await import(
      "@/lib/dues-messaging"
    );

    const cards: BoardCard[] = rows.map((m) => {
      const c = byId.get(m.client_id);
      const isDraft = m.status === "ready_not_sent";
      const fresh =
        c && isDraft
          ? m.message_type === "renewal_due"
            ? buildRenewalDraft(c, dismissed.has(c.id))
            : m.message_type === "consent_confirmation"
              ? buildConsentConfirmationDraft(c)
              : buildBalanceDraft(c, dismissed.has(c.id))
          : null;

      // A dues draft whose balance was settled is no longer sendable, even
      // though the row has not been closed out yet.
      const settled =
        !!fresh && fresh.messageType !== "consent_confirmation" && !(fresh.amountDue > 0);
      const warnings = fresh
        ? settled && !fresh.warnings.includes("Amount due is $0 or less")
          ? [...fresh.warnings, "Balance no longer due"]
          : fresh.warnings
        : (m.validation_warnings ?? []);

      return {
        id: m.id,
        clientId: m.client_id,
        clientName: c ? fullName(c as never) : "Unknown client",
        messageType: m.message_type,
        status: m.status,
        body: fresh?.body ?? m.body,
        amountDue: Number(fresh?.amountDue ?? m.amount_due ?? 0),
        blocked: fresh ? fresh.blocked || settled : isDraft ? true : m.blocked,
        warnings: warnings.length > 0 ? warnings : isDraft && !c ? ["Client record missing"] : warnings,
        eligibility: c ? smsEligibility(c) : "invalid_phone",
        packageName: c?.package_name ?? null,
        visitsUsed: c?.visits_used ?? null,
        visitsTotal: c?.package_total_visits ?? null,
        renewalStartDate:
          m.message_type === "renewal_due"
            ? (c?.pending_renewal_start_date ?? m.package_start_date)
            : null,
        twilioSid: m.twilio_sid,
        errorMessage: m.error_message ?? null,
        sentAt: m.sent_at,
        createdAt: m.created_at,
      };
    });

    return buildDuesTextsBoard(cards);
  });
