/* Dues messaging dry-run acceptance test. Scoped to disposable ZZTEST records. */
import { createClient } from "@supabase/supabase-js";
import {
  runGenerateDuesPreviews,
  TEST_CLIENT_PREFIX,
} from "@/lib/dues-messaging.functions";
import { isSendable } from "@/lib/dues-messaging";
import { sendDuesMessage, smsSendingEnabled } from "@/lib/dues-sms.server";

process.env["DUES_ACCEPTANCE_TEST_MODE"] = "true";

const url = process.env["SUPABASE_URL"]!;
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const db = createClient(url, key, {
  global: {
    fetch: (input: any, init: any) => {
      const h = new Headers(init?.headers ?? {});
      if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
      h.set("apikey", key);
      return fetch(input, { ...init, headers: h });
    },
  },
  auth: { persistSession: false, autoRefreshToken: false },
});
const ctx = { supabase: db, userId: "acceptance-runner" } as any;

// --- outbound transport instrumentation -------------------------------------
const SMS_HOSTS = ["twilio.com", "messagebird", "vonage", "nexmo", "plivo", "telnyx"];
let smsCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const u = typeof input === "string" ? input : (input?.url ?? "");
  if (SMS_HOSTS.some((h) => String(u).includes(h))) smsCalls++;
  return realFetch(input as any, init);
}) as typeof fetch;

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function all(table: string, cols: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const FIN_COLS =
  "id, package_price, package_total_visits, visits_used, amount_paid, previous_package_owed, package_start_date, pending_renewal_start_date, pending_renewal_price, pending_renewal_total_visits, pending_renewal_package_name, pending_renewal_paid, sms_consent_at, sms_consent_source, sms_opted_out_at";

async function financialBaseline() {
  const rows = await all("clients", FIN_COLS);
  return new Map(rows.map((r) => [r.id, JSON.stringify(r)]));
}
async function messagingBaseline() {
  const msgs = await all("dues_messages", "id");
  const acts = (await all("client_activities", "id, activity_type")).filter((a) =>
    String(a.activity_type).startsWith("dues_message_"),
  );
  return { msgIds: new Set(msgs.map((m) => m.id)), actIds: new Set(acts.map((a) => a.id)) };
}
async function messagingCounts() {
  const { count: m } = await db
    .from("dues_messages")
    .select("id", { count: "exact", head: true });
  const { count: a } = await db
    .from("client_activities")
    .select("id", { count: "exact", head: true })
    .like("activity_type", "dues_message_%");
  return { m: m ?? 0, a: a ?? 0 };
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const consent = { sms_consent_at: "2026-01-01T00:00:00Z", sms_consent_source: "intake form" };

type Spec = { key: string; row: Record<string, unknown> };
const specs: Spec[] = [
  {
    key: "unpaid_consented",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} Unpaid`,
      last_name: `${TEST_CLIENT_PREFIX}`,
      phone: "(555) 010-0001",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 100,
      package_start_date: "2026-09-01",
      visits_used: 3,
      ...consent,
    },
  },
  {
    key: "no_consent",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} NoConsent`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0002",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 0,
      package_start_date: "2026-09-01",
    },
  },
  {
    key: "opted_out",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} OptOut`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0003",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 0,
      package_start_date: "2026-09-01",
      ...consent,
      sms_opted_out_at: "2026-06-01T00:00:00Z",
    },
  },
  {
    key: "bad_phone",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} BadPhone`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "12-34",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 0,
      package_start_date: "2026-09-01",
      ...consent,
    },
  },
  {
    key: "fully_paid",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} Paid`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0005",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 375,
      package_start_date: "2026-09-01",
      ...consent,
    },
  },
  {
    key: "prepaid_renewal",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} Prepaid`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0006",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 375,
      package_start_date: "2026-08-01",
      visits_used: 8,
      pending_renewal_start_date: tomorrow,
      pending_renewal_price: 375,
      pending_renewal_total_visits: 8,
      pending_renewal_package_name: "8 visits",
      pending_renewal_paid: 100,
      ...consent,
    },
  },
  {
    key: "package_info_needed",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} NoPkgInfo`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0007",
      package_price: 0,
      package_total_visits: 8,
      amount_paid: 200,
      ...consent,
    },
  },
  {
    key: "payment_review",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} Overpaid`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0008",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 690,
      package_start_date: "2026-09-01",
      ...consent,
    },
  },
  {
    key: "ppv_unpaid",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} PayPerVisit`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0009",
      payment_model: "pay_per_visit",
      package_total_visits: 0,
      package_price: 150,
      amount_paid: 0,
      package_start_date: "2026-09-01",
      ...consent,
    },
  },
  {
    key: "renewal_invalid",
    row: {
      first_name: `${TEST_CLIENT_PREFIX} BadRenewal`,
      last_name: TEST_CLIENT_PREFIX,
      phone: "(555) 010-0010",
      package_name: "8 visits",
      package_total_visits: 8,
      package_price: 375,
      amount_paid: 375,
      package_start_date: "2026-08-01",
      pending_renewal_start_date: tomorrow,
      pending_renewal_price: 0,
      pending_renewal_total_visits: 0,
      ...consent,
    },
  },
];

async function main() {
  const finBase = await financialBaseline();
  const msgBase = await messagingBaseline();
  console.log(
    `baseline: ${finBase.size} clients, ${msgBase.msgIds.size} messages, ${msgBase.actIds.size} message activities`,
  );

  // --- fail-closed guard, before creating anything ---------------------------
  let before = await messagingCounts();
  let threw = "";
  try {
    await runGenerateDuesPreviews(ctx, {});
  } catch (e: any) {
    threw = e.message;
  }
  let after = await messagingCounts();
  check(
    "acceptance mode without scope throws and writes nothing",
    /requires a non-empty clientIds/.test(threw) && before.m === after.m && before.a === after.a,
    threw,
  );

  const { data: realClient } = await db
    .from("clients")
    .select("id, first_name")
    .not("first_name", "like", `${TEST_CLIENT_PREFIX}%`)
    .limit(1)
    .single();
  before = await messagingCounts();
  threw = "";
  try {
    await runGenerateDuesPreviews(ctx, { clientIds: [realClient!.id] });
  } catch (e: any) {
    threw = e.message;
  }
  after = await messagingCounts();
  check(
    "acceptance mode with a real client ID refuses and writes nothing",
    /non-test client IDs/.test(threw) && before.m === after.m && before.a === after.a,
    threw,
  );

  // --- cohort ----------------------------------------------------------------
  const ids: Record<string, string> = {};
  for (const s of specs) {
    const { data, error } = await db.from("clients").insert(s.row).select("id").single();
    if (error) throw new Error(`${s.key}: ${error.message}`);
    ids[s.key] = data!.id;
  }
  const scope = Object.values(ids);
  console.log(`created ${scope.length} ZZTEST clients`);

  const drafts = async (clientId: string) =>
    (await db.from("dues_messages").select("*").eq("client_id", clientId)).data ?? [];
  const acts = async (clientId: string) =>
    (
      await db
        .from("client_activities")
        .select("*")
        .eq("client_id", clientId)
        .like("activity_type", "dues_message_%")
    ).data ?? [];

  try {
    // 1st generation
    const r1 = await runGenerateDuesPreviews(ctx, { clientIds: scope });
    console.log("run 1:", r1);

    const unpaid = await drafts(ids["unpaid_consented"]!);
    check(
      "unpaid consented client gets one unblocked balance draft",
      unpaid.length === 1 &&
        unpaid[0].message_type === "balance_due" &&
        unpaid[0].blocked === false &&
        Number(unpaid[0].amount_due) === 275,
      JSON.stringify(unpaid.map((d) => [d.message_type, d.amount_due, d.blocked])),
    );
    check(
      "balance body is generic and exact",
      unpaid[0]?.body ===
        "Hi ZZTEST Unpaid, this is FIT Beyond Therapy. Just a reminder that our records show a remaining balance of $275.00. Reply here if you have any questions. Reply STOP to opt out.",
      unpaid[0]?.body,
    );

    const blockedCase = async (key: string, reason: string) => {
      const d = await drafts(ids[key]!);
      check(
        `${key}: blocked with "${reason}"`,
        d.length > 0 && d[0].blocked === true && (d[0].validation_warnings ?? []).includes(reason),
        JSON.stringify(d[0]?.validation_warnings ?? []),
      );
    };
    await blockedCase("no_consent", "No recorded texting consent");
    await blockedCase("opted_out", "Client opted out of texts");
    await blockedCase("bad_phone", "No usable phone number on file");

    check("fully paid client gets no draft", (await drafts(ids["fully_paid"]!)).length === 0);
    check(
      "Package Info Needed gets no balance draft",
      (await drafts(ids["package_info_needed"]!)).length === 0,
    );
    check(
      "Payment Review gets no balance draft",
      (await drafts(ids["payment_review"]!)).length === 0,
    );
    const ppv = await drafts(ids["ppv_unpaid"]!);
    check(
      "pay-per-visit with unpaid balance is queued",
      ppv.length === 1 && Number(ppv[0].amount_due) === 150,
      JSON.stringify(ppv.map((d) => d.amount_due)),
    );

    const prep = await drafts(ids["prepaid_renewal"]!);
    const ren = prep.find((d: any) => d.message_type === "renewal_due");
    check(
      "prepaid prepared renewal drafts only the remaining amount ($275)",
      !!ren && Number(ren.amount_due) === 275 && ren.blocked === false,
      JSON.stringify(prep.map((d) => [d.message_type, d.amount_due, d.blocked])),
    );

    const badRen = await drafts(ids["renewal_invalid"]!);
    const w = badRen[0]?.validation_warnings ?? [];
    check(
      "renewal with no price/visits is blocked with both reasons",
      badRen.length === 1 &&
        badRen[0].blocked === true &&
        w.includes("Prepared package has no price") &&
        w.includes("Prepared package has no visit count"),
      JSON.stringify(w),
    );

    // idempotency
    const countBefore = (await db.from("dues_messages").select("id", { count: "exact", head: true }))
      .count;
    const actsBefore = (await acts(ids["unpaid_consented"]!)).length;
    const r2 = await runGenerateDuesPreviews(ctx, { clientIds: scope });
    const countAfter = (await db.from("dues_messages").select("id", { count: "exact", head: true }))
      .count;
    check(
      "repeat generation creates no duplicates and no extra activity",
      r2.created === 0 &&
        r2.updated === 0 &&
        countBefore === countAfter &&
        (await acts(ids["unpaid_consented"]!)).length === actsBefore,
      JSON.stringify(r2),
    );

    // renewal date + price change rewrites the same unsent draft
    const renewalId = ren!.id;
    const newDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    await db
      .from("clients")
      .update({ pending_renewal_start_date: newDate, pending_renewal_price: 400 })
      .eq("id", ids["prepaid_renewal"]!);
    await runGenerateDuesPreviews(ctx, { clientIds: scope });
    const prep2 = (await drafts(ids["prepaid_renewal"]!)).filter(
      (d: any) => d.message_type === "renewal_due",
    );
    check(
      "changing renewal date and price updates the same draft row",
      prep2.length === 1 &&
        prep2[0].id === renewalId &&
        Number(prep2[0].amount_due) === 300 &&
        prep2[0].package_start_date === newDate,
      JSON.stringify(prep2.map((d) => [d.id === renewalId, d.amount_due, d.package_start_date])),
    );

    // payment before send
    await db
      .from("clients")
      .update({ amount_paid: 375 })
      .eq("id", ids["unpaid_consented"]!);
    const r3 = await runGenerateDuesPreviews(ctx, { clientIds: scope });
    const closedDraft = (await drafts(ids["unpaid_consented"]!))[0];
    check(
      "payment before sending closes the draft as Payment Received",
      closedDraft?.status === "payment_received" &&
        r3.closed >= 1 &&
        !isSendable(closedDraft as any),
      `${closedDraft?.status} closed=${r3.closed}`,
    );

    // send gate
    check("sending flag reads OFF", smsSendingEnabled() === false);
    let sendErr = "";
    try {
      await sendDuesMessage({
        id: "x",
        phone: "+15550100001",
        body: "hi",
        status: "ready_not_sent",
        blocked: false,
      });
    } catch (e: any) {
      sendErr = e.message;
    }
    check("send module throws while the flag is off", /disabled/i.test(sendErr), sendErr);

    const blockedRow = (await drafts(ids["no_consent"]!))[0];
    process.env["SMS_DUES_SENDING_ENABLED"] = "true";
    let blockedErr = "";
    try {
      await sendDuesMessage({
        id: blockedRow.id,
        phone: blockedRow.phone ?? "+15550100002",
        body: blockedRow.body,
        status: blockedRow.status,
        blocked: blockedRow.blocked,
      });
    } catch (e: any) {
      blockedErr = e.message;
    }
    delete process.env["SMS_DUES_SENDING_ENABLED"];
    check(
      "blocked + ready_not_sent draft still cannot send",
      blockedRow.status === "ready_not_sent" &&
        blockedRow.blocked === true &&
        /blocked/i.test(blockedErr),
      blockedErr,
    );
  } finally {
    // --- cleanup -------------------------------------------------------------
    await db.from("dues_messages").delete().in("client_id", scope);
    await db.from("client_activities").delete().in("client_id", scope);
    await db.from("clients").delete().in("id", scope);
  }

  const leftoverMsgs = (await db.from("dues_messages").select("id").in("client_id", scope)).data ?? [];
  const leftoverActs =
    (await db.from("client_activities").select("id").in("client_id", scope)).data ?? [];
  const leftoverClients =
    (await db.from("clients").select("id").in("id", scope)).data ?? [];
  const leftoverByName =
    (await db.from("clients").select("id").like("first_name", `${TEST_CLIENT_PREFIX}%`)).data ?? [];
  check(
    "cleanup leaves zero test artifacts",
    leftoverMsgs.length === 0 &&
      leftoverActs.length === 0 &&
      leftoverClients.length === 0 &&
      leftoverByName.length === 0,
    `msgs=${leftoverMsgs.length} acts=${leftoverActs.length} clients=${leftoverClients.length} byName=${leftoverByName.length}`,
  );

  // --- baselines -------------------------------------------------------------
  const finAfter = await financialBaseline();
  let finDrift = 0;
  for (const [id, snap] of finBase) {
    if (finAfter.get(id) !== snap) finDrift++;
  }
  check("no real-client financial/package/consent changes", finDrift === 0, `${finDrift} drifted`);

  const msgAfter = await messagingBaseline();
  const addedMsgs = [...msgAfter.msgIds].filter((i) => !msgBase.msgIds.has(i));
  const lostMsgs = [...msgBase.msgIds].filter((i) => !msgAfter.msgIds.has(i));
  const addedActs = [...msgAfter.actIds].filter((i) => !msgBase.actIds.has(i));
  const lostActs = [...msgBase.actIds].filter((i) => !msgAfter.actIds.has(i));
  check(
    "no real-client messaging or timeline changes",
    !addedMsgs.length && !lostMsgs.length && !addedActs.length && !lostActs.length,
    `+${addedMsgs.length}/-${lostMsgs.length} msgs, +${addedActs.length}/-${lostActs.length} acts`,
  );

  check("zero outbound SMS provider calls", smsCalls === 0, `${smsCalls} calls`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nAcceptance: ${passed}/${results.length} passed`);
  console.log(`Outbound SMS calls: ${smsCalls}`);
  console.log(`Real-client financial changes: ${finDrift}`);
  console.log(
    `Real-client messaging changes: ${addedMsgs.length + lostMsgs.length + addedActs.length + lostActs.length}`,
  );
  console.log(`ZZTEST artifacts remaining: ${leftoverMsgs.length + leftoverActs.length + leftoverClients.length}`);
  console.log(`Sending flag: ${smsSendingEnabled() ? "ON" : "OFF"}`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("RUN FAILED", e);
  process.exitCode = 1;
});
