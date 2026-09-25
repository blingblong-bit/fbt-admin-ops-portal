// Final read-only acceptance test: Square notes → effective visit state →
// renewal timing → Payment Due week → dues-draft eligibility → last-visit text.
// Pure and in-memory: nothing is read from or written to the database/Square.
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { drivingCounts, forecastRenewal, resolveEffectiveVisitState } from "./effective-visit-state";
import { workWeekStartFromYmd, addDaysYmd } from "./work-week";
import { groupWeeklyPayments, type WeeklyRenewalForecast } from "./weekly-payment-groups";
import { isDuesQueueEligible, renewalAmountDue } from "./dues-messaging";
import { amountOwed, previousOwed, totalOwed, paymentStatus, type Client } from "./clients";
import { decideRenewalText } from "./renewal-text-eligibility";
import { computeRenewalTransition, routePayment } from "./payment-routing";

const NOW = "2026-09-21T12:00:00Z"; // Monday
const THIS_WEEK = workWeekStartFromYmd("2026-09-21");
const NEXT_WEEK = addDaysYmd(THIS_WEEK, 7);

type B = { id: string; start_at: string; seller_note: string; status: string };
const b = (id: string, d: string, note: string, status = "ACCEPTED", hh = "15"): B => ({ id, start_at: `${d}T${hh}:00:00Z`, seller_note: note, status });

function mkClient(o: Partial<Client> & { id: string }): Client {
  return {
    first_name: "Test", last_name: o.id, phone: "9315550000", email: null,
    package_name: "8 visits", package_total_visits: 8, package_price: 400, package_start_date: "2026-08-01",
    visits_used: 0, amount_paid: 400, previous_package_owed: 0, payment_model: "package", status: "active",
    deleted_at: null, square_customer_id: "SQ", next_package_price: null,
    pending_renewal_start_date: null, pending_renewal_price: null, pending_renewal_total_visits: null,
    pending_renewal_package_name: null, pending_renewal_paid: 0,
    sms_consent_at: "2026-01-01T00:00:00Z", sms_opted_out_at: null,
    ...o,
  } as unknown as Client;
}

/** Mirrors getRenewalForecast's per-client logic using the shared pure pieces. */
function runChain(c: Client, bookings: B[]) {
  const state = resolveEffectiveVisitState(c as never, bookings, NOW);
  const starts = bookings
    .filter((x) => x.start_at >= NOW && !/CANCEL|DECLIN|NO_SHOW/i.test(x.status))
    .map((x) => x.start_at).sort();
  const drive = drivingCounts(state);
  const fc = forecastRenewal({ upcomingStarts: starts, visitsUsed: drive.used, totalVisits: drive.total, nextPackageStart: drive.nextPackageStart });
  const pending = (c as any).pending_renewal_start_date as string | null;
  let forecast: WeeklyRenewalForecast | undefined;
  let week: "this" | "next" | "later" | "none" = "none";
  if (fc.needsRenewal && fc.firstUncoveredStart) {
    const firstYmd = fc.firstUncoveredStart.slice(0, 10);
    const ws = workWeekStartFromYmd(pending ?? firstYmd);
    week = ws === THIS_WEEK ? "this" : ws === NEXT_WEEK ? "next" : "later";
    const pendingPrice = (c as any).pending_renewal_price == null ? null : Number((c as any).pending_renewal_price);
    const override = (c as any).next_package_price == null ? null : Number((c as any).next_package_price);
    const nextFull = pendingPrice ?? override ?? Number(c.package_price);
    // Same value getRenewalForecast puts on the row today.
    forecast = { client_id: c.id, week_bucket: week, next_package_price: nextFull, pre_renewed: !!pending, first_uncovered_ymd: firstYmd, pending_start_ymd: pending };
  }
  const status = paymentStatus(c as never);
  const excluded = status === "package_info_needed" || status === "payment_review";
  const fmap = new Map<string, WeeklyRenewalForecast>();
  if (forecast && !excluded) fmap.set(c.id, forecast);
  const groups = groupWeeklyPayments(excluded ? [] : [c], fmap, "this", (cl) => amountOwed(cl) > 0);
  const groupsNext = groupWeeklyPayments(excluded ? [] : [c], fmap, "next", () => false);
  const renewalDraft = !!pending && renewalAmountDue(c as never) > 0;
  const balanceDraft = isDuesQueueEligible(c as never);
  const text = decideRenewalText(c as never, state, starts, false);
  return { state, fc, week, forecast, groups, groupsNext, renewalDraft, balanceDraft, text, status, excluded };
}

type Row = Record<string, string | number | boolean | null>;
const report: Row[] = [];
function record(name: string, c: Client, r: ReturnType<typeof runChain>, pass: boolean, note = "") {
  report.push({
    case: name,
    source: r.state.source, review: r.state.reviewStatus, automation_usable: r.state.automationUsable,
    position: `${drivingCounts(r.state).used}/${drivingCounts(r.state).total}`,
    next_package_start: r.state.nextPackageStart?.slice(0, 10) ?? r.forecast?.first_uncovered_ymd ?? null,
    current_due: amountOwed(c), previous_due: previousOwed(c),
    next_due: r.groups.totals.nextPackage || r.groupsNext.totals.nextPackage,
    payment_due_week: r.week,
    needs_renewal: r.groups.needsRenewal.length + r.groupsNext.needsRenewal.length > 0,
    renewal_scheduled: r.groups.renewalScheduled.length + r.groupsNext.renewalScheduled.length > 0,
    dues_draft: r.renewalDraft || r.balanceDraft,
    last_visit_text: r.text.eligible,
    pass, note,
  });
}

afterAll(() => {
  try { writeFileSync("/tmp/acceptance-report.json", JSON.stringify(report, null, 2)); } catch { /* ignore */ }
});

const done = (id: string, over: Partial<Client> = {}) => mkClient({ id, visits_used: 0, ...over });

describe("acceptance: package boundary timing", () => {
  it("1 same-week boundary (Mon 8/8, Thu 1/8) → this week", () => {
    const c = done("same-week");
    const r = runChain(c, [b("a", "2026-09-10", "6/8"), b("b", "2026-09-17", "7/8"), b("c", "2026-09-21", "8/8"), b("d", "2026-09-24", "1/8")]);
    const pass = r.week === "this" && r.groups.totals.nextPackage === 400 && r.state.source === "square";
    record("1 Same-week boundary", c, r, pass);
    expect(pass).toBe(true);
  });
  it("2 consecutive-day boundary (Tue 8/8, Wed 1/8) → this week", () => {
    const c = done("consecutive");
    const r = runChain(c, [b("a", "2026-09-17", "7/8"), b("b", "2026-09-22", "8/8"), b("c", "2026-09-23", "1/8")]);
    const pass = r.week === "this" && r.groups.totals.nextPackage === 400;
    record("2 Consecutive-day boundary", c, r, pass);
    expect(pass).toBe(true);
  });
  it("3 first 1/8 of the new package this week → this week", () => {
    const c = done("first-visit");
    const r = runChain(c, [b("a", "2026-09-10", "7/8"), b("b", "2026-09-17", "8/8"), b("c", "2026-09-24", "1/8")]);
    const pass = r.week === "this" && r.groups.totals.nextPackage === 400 && r.state.visitsUsed === 8;
    record("3 First visit of a package", c, r, pass);
    expect(pass).toBe(true);
  });
  it("4 8/8 this week, 1/8 next week → next week, not this week", () => {
    const c = done("next-week");
    const r = runChain(c, [b("a", "2026-09-17", "7/8"), b("b", "2026-09-22", "8/8"), b("c", "2026-09-29", "1/8")]);
    const pass = r.week === "next" && r.groups.totals.nextPackage === 0 && r.groupsNext.totals.nextPackage === 400;
    record("4 Boundary next week", c, r, pass);
    expect(pass).toBe(true);
  });
  it("5 7/8 → 8/8 → 1/8 in one week → single next-package amount", () => {
    const c = done("multi");
    const r = runChain(c, [b("a", "2026-09-17", "6/8"), b("b", "2026-09-22", "7/8"), b("c", "2026-09-23", "8/8"), b("d", "2026-09-24", "1/8")]);
    const pass = r.week === "this" && r.groups.needsRenewal.length === 1 && r.groups.totals.nextPackage === 400;
    record("5 Multiple visits same week", c, r, pass);
    expect(pass).toBe(true);
  });
});

describe("acceptance: money categories", () => {
  it("6 current + previous balance and next package this week, no double counting", () => {
    const c = done("owes-plus-next", { amount_paid: 150, previous_package_owed: 100 });
    const r = runChain(c, [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")]);
    const pass = r.groups.current.length === 1 && r.groups.totals.current === 250 && r.groups.totals.nextPackage === 400 &&
      r.groups.totals.combined === 650 && r.balanceDraft && totalOwed(c) === 350;
    record("6 Current balance + next-package obligation", c, r, pass, "previous $100 is carried in the balance text, not the weekly current column");
    expect(pass).toBe(true);
  });
  it("7 prepared renewal partially prepaid → only the remainder", () => {
    const c = done("partial", { pending_renewal_start_date: "2026-09-24", pending_renewal_price: 400, pending_renewal_total_visits: 8, pending_renewal_paid: 150 } as never);
    const r = runChain(c, [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")]);
    const pass = r.groups.renewalScheduled.length === 1 && r.groups.totals.nextPackage === 250 && renewalAmountDue(c as never) === 250 && r.renewalDraft;
    record("7 Prepared renewal partially prepaid", c, r, pass);
    expect(pass).toBe(true);
  });
  it("8 prepared renewal fully prepaid → $0 and no renewal dues text", () => {
    const c = done("full", { pending_renewal_start_date: "2026-09-24", pending_renewal_price: 400, pending_renewal_total_visits: 8, pending_renewal_paid: 400 } as never);
    const r = runChain(c, [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")]);
    const pass = r.groups.totals.nextPackage === 0 && !r.renewalDraft;
    record("8 Prepared renewal fully prepaid", c, r, pass);
    expect(pass).toBe(true);
  });
  it("Package Info Needed and Payment Review stay out of money totals and dues", () => {
    const pin = done("pin", { package_price: 0, amount_paid: 0 });
    const pr = done("pr", { amount_paid: 800 });
    const bk = [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")];
    const r1 = runChain(pin, bk), r2 = runChain(pr, bk);
    const pass = r1.excluded && r2.excluded && r1.groups.totals.combined === 0 && r2.groups.totals.combined === 0 && !r1.balanceDraft && !r2.balanceDraft;
    record("Package Info Needed excluded", pin, r1, r1.excluded && !r1.balanceDraft);
    record("Payment Review excluded", pr, r2, r2.excluded && !r2.balanceDraft);
    expect(pass).toBe(true);
  });
});

describe("acceptance: visit source and review", () => {
  const up = [b("u1", "2026-09-22", ""), b("u2", "2026-09-29", ""), b("u3", "2026-10-06", "")];
  it("9 Square synced with a stale Hub count → Square drives", () => {
    const c = done("sq", { visits_used: 2 });
    const r = runChain(c, [b("a", "2026-09-10", "5/8"), b("b", "2026-09-17", "6/8"), ...up]);
    const pass = r.state.source === "square" && drivingCounts(r.state).used === 6 && r.fc.needsRenewal && r.forecast?.first_uncovered_ymd === "2026-10-06";
    record("9 Square synced (Hub differs)", c, r, pass);
    expect(pass).toBe(true);
  });
  it("10 Hub fallback → today's Hub workflow unchanged", () => {
    const c = done("hub", { visits_used: 7 });
    const r = runChain(c, up);
    const legacy = forecastRenewal({ upcomingStarts: up.map((x) => x.start_at), visitsUsed: 7, totalVisits: 8, nextPackageStart: null });
    const pass = r.state.source === "hub_fallback" && r.state.automationUsable && r.fc.firstUncoveredStart === legacy.firstUncoveredStart;
    record("10 Hub fallback", c, r, pass);
    expect(pass).toBe(true);
  });
  it("11a Square + needs review (old skip, clear latest) → still Square-driven", () => {
    const c = done("flagged", { visits_used: 1 });
    const r = runChain(c, [b("a", "2026-08-01", "2/8"), b("b", "2026-08-08", "4/8"), b("c", "2026-08-15", "5/8"), b("d", "2026-09-17", "6/8"), ...up]);
    const pass = r.state.source === "square" && r.state.reviewStatus === "needs_review" && r.state.automationUsable && drivingCounts(r.state).used === 6;
    record("11a Square + Needs review", c, r, pass);
    expect(pass).toBe(true);
  });
  it("11b unreadable current Square position → held, no new decision", () => {
    const c = done("held", { visits_used: 3 });
    const bk = [b("a", "2026-09-10", "4/8"), b("b", "2026-09-17", "5/8", "ACCEPTED", "14"), b("c", "2026-09-17", "2/8", "ACCEPTED", "16"), ...up];
    const r = runChain(c, bk);
    const hubOnly = forecastRenewal({ upcomingStarts: up.map((x) => x.start_at), visitsUsed: 3, totalVisits: 8, nextPackageStart: null });
    const pass = !r.state.automationUsable && r.fc.needsRenewal === hubOnly.needsRenewal && r.fc.firstUncoveredStart === hubOnly.firstUncoveredStart && !r.text.eligible && r.text.suppressed;
    record("11b Unreadable Square → held", c, r, pass);
    expect(pass).toBe(true);
  });
  it("12 cancelled numbered visit stays in the sequence", () => {
    const c = done("cancel", { visits_used: 5 });
    const r = runChain(c, [b("a", "2026-09-02", "6/8"), b("b", "2026-09-09", "7/8", "CANCELLED_BY_SELLER"), b("c", "2026-09-16", "8/8"), b("d", "2026-09-24", "1/8")]);
    const pass = r.state.source === "square" && r.state.reviewStatus === "clean" && r.state.visitsUsed === 8 && r.week === "this";
    record("12 Cancelled numbered visit", c, r, pass);
    expect(pass).toBe(true);
  });
});

describe("acceptance: last-visit renewal text", () => {
  const bk = [b("a", "2026-09-10", "6/8"), b("b", "2026-09-17", "7/8"), b("c", "2026-09-24", "8/8"), b("d", "2026-10-01", "1/8")];
  it("13 Square 7/8 with future 8/8 → qualifies; opt-out and no-consent still block", () => {
    const c = done("text", { visits_used: 3 });
    const r = runChain(c, bk);
    const opt = runChain(done("text-opt", { visits_used: 3, sms_opted_out_at: "2026-05-01T00:00:00Z" } as never), bk);
    const noc = runChain(done("text-noc", { visits_used: 3, sms_consent_at: null } as never), bk);
    const pass = r.text.eligible && !opt.text.eligible && opt.text.consentBlocked === "opted_out" && !noc.text.eligible && noc.text.consentBlocked === "no_consent";
    record("13 Renewal text on 7/8 (+ consent/opt-out)", c, r, pass);
    expect(pass).toBe(true);
  });
  it("14 Square 8/8 already completed → no last-visit text", () => {
    const c = done("text-done", { visits_used: 7 });
    const r = runChain(c, [b("a", "2026-09-10", "7/8"), b("b", "2026-09-17", "8/8"), b("c", "2026-09-24", "1/8"), b("d", "2026-10-01", "2/8")]);
    const pass = !r.text.eligible;
    record("14 Renewal text after package complete", c, r, pass);
    expect(pass).toBe(true);
  });
});

describe("acceptance: reconciliation", () => {
  it("no client twice in the same bucket; totals reconcile", () => {
    const bk = [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")];
    const cs = [done("r1", { amount_paid: 100 }), done("r2"), done("r3", { pending_renewal_start_date: "2026-09-24", pending_renewal_price: 400, pending_renewal_paid: 100 } as never)];
    const fm = new Map<string, WeeklyRenewalForecast>();
    for (const c of cs) { const r = runChain(c, bk); if (r.forecast) fm.set(c.id, r.forecast); }
    const g = groupWeeklyPayments(cs, fm, "this", (c) => amountOwed(c) > 0);
    for (const list of [g.current, g.renewalScheduled, g.needsRenewal]) {
      expect(new Set(list.map((x) => x.client.id)).size).toBe(list.length);
    }
    expect(g.totals.combined).toBe(g.totals.current + g.totals.nextPackage);
    expect(g.totals.nextPackage).toBe(g.totals.renewalScheduled + g.totals.needsRenewal);
    report.push({ case: "Reconcile: unique buckets + totals", pass: true, note: `combined ${g.totals.combined}` });
  });
  it("activating a prepared renewal moves money between buckets only", () => {
    const pre = done("act", { pending_renewal_start_date: "2026-09-24", pending_renewal_price: 400, pending_renewal_total_visits: 8, pending_renewal_paid: 150 } as never);
    const bk = [b("a", "2026-09-17", "7/8"), b("b", "2026-09-21", "8/8"), b("c", "2026-09-24", "1/8")];
    const before = runChain(pre, bk).groups.totals.combined;
    const t = computeRenewalTransition({ previousPackageOwed: 0, amountPaid: 400, packagePrice: 400, pendingRenewalPaid: 150 });
    const post = done("act", { package_price: 400, amount_paid: t.amountPaid, previous_package_owed: t.previousPackageOwed });
    const after = groupWeeklyPayments([post], new Map(), "this", (c) => amountOwed(c) > 0).totals.combined;
    const pass = before === after && before === 250;
    report.push({ case: "Reconcile: activation keeps combined total", pass, note: `before ${before} → after ${after}` });
    expect(pass).toBe(true);
  });
  it("a payment before sending closes the dues obligation", () => {
    const c = done("paid", { amount_paid: 150, previous_package_owed: 100 });
    expect(isDuesQueueEligible(c as never)).toBe(true);
    const r = routePayment({ previousPackageOwed: 100, amountPaid: 150, packagePrice: 400, pendingRenewalPaid: 0, hasPreparedRenewal: false }, 350);
    const after = done("paid", { amount_paid: r.next.amountPaid, previous_package_owed: r.next.previousPackageOwed });
    const pass = !isDuesQueueEligible(after as never) && r.toPreviousPackage === 100;
    report.push({ case: "Reconcile: payment before send closes dues", pass });
    expect(pass).toBe(true);
  });
});
