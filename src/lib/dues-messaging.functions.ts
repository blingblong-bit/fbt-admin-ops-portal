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
import { totalOwed } from "@/lib/clients";

type Ctx = { supabase: any; userId: string };

async function assertAdmin(context: Ctx) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superadmin" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("Forbidden — admin access required");
}

const CLIENT_COLUMNS =
  "id, first_name, last_name, phone, package_name, package_total_visits, package_price, package_start_date, visits_used, amount_paid, previous_package_owed, payment_model, status, deleted_at, pending_renewal_start_date, pending_renewal_price, pending_renewal_total_visits, pending_renewal_package_name, pending_renewal_paid, sms_consent_at, sms_consent_source, sms_opted_out_at";

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
      description: `Dues message drafted (${plan.messageType === "renewal_due" ? "renewal" : "balance"}) — not sent.`,
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
