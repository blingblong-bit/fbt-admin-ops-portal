// Pure decision logic for the automatic "last visit" renewal text.
// Shared by the live job (renewal.tick) and the read-only dry run.
import type { EffectiveVisitState } from "@/lib/effective-visit-state";

export type RenewalTextClient = {
  id: string;
  phone: string | null;
  square_customer_id: string | null;
  package_total_visits: number;
  visits_used: number | null;
  package_price: number;
  amount_paid: number;
  sms_consent_at: string | null;
  sms_opted_out_at: string | null;
};

export type RenewalDecision = {
  eligible: boolean;
  reason: string;
  basis: string;
  lastVisitDate: string | null; // ISO start of the last visit appointment
  suppressed: boolean;
  consentBlocked: "no_consent" | "opted_out" | null;
};

/** Consent is mandatory; any opt-out on record blocks automatic renewal texts. */
export function renewalConsentBlock(c: Pick<RenewalTextClient, "sms_consent_at" | "sms_opted_out_at">) {
  if (c.sms_opted_out_at) return "opted_out" as const;
  if (!c.sms_consent_at) return "no_consent" as const;
  return null;
}

/** Legacy rule (stored Hub count) — used only for the before/after comparison. */
export function decideLegacy(
  c: RenewalTextClient,
  acceptedUpcoming: string[],
  hasOpenCampaign: boolean,
): RenewalDecision {
  const used = c.visits_used ?? 0;
  const basis = `Hub ${used}/${c.package_total_visits}`;
  const no = (reason: string): RenewalDecision => ({ eligible: false, reason, basis, lastVisitDate: null, suppressed: false, consentBlocked: null });
  if (used !== c.package_total_visits - 1) return no("not on last visit");
  if (Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0) > 0.001) return no("balance owed");
  if (!c.phone) return no("no phone");
  if (!c.square_customer_id) return no("not linked to Square");
  if (hasOpenCampaign) return no("campaign already open");
  if (acceptedUpcoming.length < 2) return no("fewer than 2 upcoming bookings");
  return { eligible: true, reason: "eligible", basis, lastVisitDate: acceptedUpcoming[0], suppressed: false, consentBlocked: null };
}

export function decideRenewalText(
  c: RenewalTextClient,
  state: EffectiveVisitState,
  acceptedUpcoming: string[],
  hasOpenCampaign: boolean,
): RenewalDecision {
  const base = { suppressed: false, consentBlocked: null as RenewalDecision["consentBlocked"] };
  if (!state.automationUsable) {
    return { ...base, eligible: false, suppressed: true, reason: "held — current Square position unreadable", basis: `Held (${state.reason})`, lastVisitDate: null };
  }
  let basis: string;
  let lastVisitDate: string | null = null;
  if (state.source === "square") {
    const { visitsUsed: used, totalVisits: total } = state;
    // Only the very next numbered live appointment can be this package's final
    // visit — a later N/N belongs to the next package.
    const nextNoted = state.upcoming.find((u) => !u.cancelled && u.note);
    const finalVisit = nextNoted?.note === `${total}/${total}` ? nextNoted : undefined;
    basis = `Square ${used}/${total}${finalVisit ? ` with future ${total}/${total}` : ""}`;
    const no = (reason: string): RenewalDecision => ({ ...base, eligible: false, reason, basis, lastVisitDate: null });
    if (total <= 0 || used !== total - 1) return no("not on last visit");
    if (!finalVisit) return no(`no future ${total}/${total} booked`);
    lastVisitDate = finalVisit.date;
  } else {
    const used = c.visits_used ?? 0;
    basis = `Hub ${used}/${c.package_total_visits}`;
    const no = (reason: string): RenewalDecision => ({ ...base, eligible: false, reason, basis, lastVisitDate: null });
    if (used !== c.package_total_visits - 1) return no("not on last visit");
    if (acceptedUpcoming.length < 2) return no("fewer than 2 upcoming bookings");
    lastVisitDate = acceptedUpcoming[0];
  }
  const no = (reason: string, cb: RenewalDecision["consentBlocked"] = null): RenewalDecision => ({ ...base, consentBlocked: cb, eligible: false, reason, basis, lastVisitDate: null });
  if (Number(c.package_price ?? 0) - Number(c.amount_paid ?? 0) > 0.001) return no("balance owed");
  if (!c.phone) return no("no phone");
  if (!c.square_customer_id) return no("not linked to Square");
  if (hasOpenCampaign) return no("campaign already open");
  const cb = renewalConsentBlock(c);
  if (cb) return no(cb === "opted_out" ? "opted out of texts" : "no SMS consent", cb);
  return { ...base, eligible: true, reason: "eligible", basis, lastVisitDate };
}

/** Effective position used to decide whether an open campaign's client has moved on. */
export function campaignShouldAutoClear(
  state: EffectiveVisitState,
  cli: { package_start_date: string | null; package_total_visits: number; visits_used: number | null },
  camp: { package_start_date_snapshot: string | null; package_total_visits_snapshot: number },
): boolean | null {
  if (!state.automationUsable) return null; // held
  const used = state.source === "square" ? state.visitsUsed : (cli.visits_used ?? 0);
  const startedNewPkg = !!cli.package_start_date &&
    (!camp.package_start_date_snapshot || cli.package_start_date > camp.package_start_date_snapshot);
  const packageChanged = cli.package_total_visits !== camp.package_total_visits_snapshot;
  const visitsReset = used < camp.package_total_visits_snapshot - 1;
  return startedNewPkg || packageChanged || visitsReset;
}

export function legacyAutoClear(
  cli: { package_start_date: string | null; package_total_visits: number; visits_used: number | null },
  camp: { package_start_date_snapshot: string | null; package_total_visits_snapshot: number },
): boolean {
  const startedNewPkg = !!cli.package_start_date &&
    (!camp.package_start_date_snapshot || cli.package_start_date > camp.package_start_date_snapshot);
  return startedNewPkg || cli.package_total_visits !== camp.package_total_visits_snapshot ||
    (cli.visits_used ?? 0) < camp.package_total_visits_snapshot - 1;
}

export function renewalAutoTextEnabled(v: string | undefined): boolean {
  return v === "true";
}
