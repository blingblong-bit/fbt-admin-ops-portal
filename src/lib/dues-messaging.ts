/**
 * Pure helpers for the dues messaging workflow (drafts only — nothing sends).
 *
 * Sending is gated server-side in `dues-sms.server.ts`. A draft is only ever
 * sendable when BOTH its status is `ready_not_sent` AND `blocked === false`.
 */
import {
  amountOwed,
  formatCurrency,
  formatDate,
  isPayPerVisit,
  packagePriceUnknown,
  previousOwed,
  totalOwed,
  unexplainedOverpayment,
  type Client,
} from "@/lib/clients";

export type DuesMessageType = "renewal_due" | "balance_due";
export type DuesMessageStatus =
  | "ready_not_sent"
  | "sent"
  | "delivered"
  | "failed"
  | "replied"
  | "payment_received";
export type DuesMessageDirection = "outbound" | "inbound";

export interface DuesMessage {
  id: string;
  client_id: string;
  phone: string | null;
  message_type: DuesMessageType | string;
  direction: DuesMessageDirection | string;
  package_start_date: string | null;
  amount_due: number;
  body: string;
  status: DuesMessageStatus | string;
  trigger_source: string;
  validation_warnings: string[] | null;
  blocked: boolean;
  twilio_sid: string | null;
  request_key: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DuesClient = Pick<
  Client,
  "id" | "first_name" | "last_name" | "phone" | "package_price" | "amount_paid"
> &
  Partial<
    Pick<
      Client,
      | "payment_model"
      | "package_name"
      | "package_total_visits"
      | "visits_used"
      | "previous_package_owed"
      | "pending_renewal_start_date"
      | "pending_renewal_price"
      | "pending_renewal_total_visits"
      | "pending_renewal_package_name"
      | "pending_renewal_paid"
      | "sms_consent_at"
      | "sms_consent_source"
      | "sms_opted_out_at"
      | "status"
      | "deleted_at"
    >
  >;

/**
 * The ONLY definition of "this draft may be handed to the send path".
 * Status alone is never enough — a blocked draft (missing consent, bad package
 * data, unusable phone) can never be sent.
 */
export function isSendable(d: Pick<DuesMessage, "status" | "blocked">): boolean {
  return d.status === "ready_not_sent" && d.blocked === false;
}

/** Digits-only US phone check. Returns the normalized number or null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Affirmative consent recorded, with no later opt-out. */
export function hasSmsConsent(
  c: Pick<DuesClient, "sms_consent_at" | "sms_opted_out_at">,
): boolean {
  if (!c.sms_consent_at) return false;
  if (!c.sms_opted_out_at) return true;
  return new Date(c.sms_opted_out_at).getTime() < new Date(c.sms_consent_at).getTime();
}

/** Amount still due on a prepared package, net of anything already prepaid. */
export function renewalAmountDue(
  c: Pick<DuesClient, "pending_renewal_price" | "pending_renewal_paid">,
): number {
  return Math.max(
    0,
    Number(c.pending_renewal_price ?? 0) - Number(c.pending_renewal_paid ?? 0),
  );
}

/**
 * Dues-queue membership: package clients with a real unpaid balance.
 * Excludes Package Info Needed, Payment Review, archived/deleted records and
 * pay-per-visit clients without an actual unpaid visit balance.
 */
export function isDuesQueueEligible(
  c: DuesClient,
  dismissedFromPackageReview = false,
): boolean {
  if (c.deleted_at) return false;
  if (c.status === "archived") return false;
  if (isPayPerVisit(c)) return totalOwed(c) > 0;
  if (packagePriceUnknown(c, dismissedFromPackageReview)) return false;
  if (unexplainedOverpayment(c)) return false;
  return totalOwed(c) > 0;
}

function money(n: number): string {
  return formatCurrency(n).replace(/^\$/, "");
}

export function renderRenewalDueMessage(input: {
  firstName: string;
  totalVisits: number;
  startDate: string;
  amount: number;
}): string {
  return `Hi ${input.firstName}, this is FIT Beyond Therapy. Your next ${input.totalVisits}-visit package is scheduled to start on ${formatDate(input.startDate)}. The amount due will be $${money(input.amount)}. Reply here if you have any questions. Reply STOP to opt out.`;
}

export function renderBalanceDueMessage(input: { firstName: string; amount: number }): string {
  // Deliberately generic: the amount may combine previous and current package debt.
  return `Hi ${input.firstName}, this is FIT Beyond Therapy. Just a reminder that our records show a remaining balance of $${money(input.amount)}. Reply here if you have any questions. Reply STOP to opt out.`;
}

/**
 * Stable key for the underlying obligation, so repeat Pre-Renew / Refresh
 * actions update one draft instead of creating duplicates.
 */
export function duesRequestKey(
  type: DuesMessageType,
  c: Pick<DuesClient, "id" | "pending_renewal_start_date" | "pending_renewal_price"> & {
    package_start_date?: string | null;
  },
): string {
  if (type === "renewal_due") {
    return `renewal:${c.id}:${c.pending_renewal_start_date ?? "none"}`;
  }
  return `balance:${c.id}:${c.package_start_date ?? "none"}`;
}

export interface DraftPlan {
  clientId: string;
  messageType: DuesMessageType;
  phone: string | null;
  packageStartDate: string | null;
  amountDue: number;
  body: string;
  warnings: string[];
  blocked: boolean;
  requestKey: string;
}

/** Blocking reasons that must all be clear before a draft could ever be sent. */
export function validateDraft(
  c: DuesClient,
  type: DuesMessageType,
  amount: number,
  dismissedFromPackageReview = false,
): string[] {
  const warnings: string[] = [];
  if (!normalizePhone(c.phone)) warnings.push("No usable phone number on file");
  if (!hasSmsConsent(c)) {
    warnings.push(
      c.sms_opted_out_at ? "Client opted out of texts" : "No recorded texting consent",
    );
  }
  if (packagePriceUnknown(c, dismissedFromPackageReview)) warnings.push("Package Info Needed");
  if (unexplainedOverpayment(c)) warnings.push("Payment Review — unexplained overpayment");
  if (!(amount > 0)) warnings.push("Amount due is $0 or less");
  if (type === "renewal_due") {
    if (!c.pending_renewal_start_date) warnings.push("Prepared package has no start date");
    if (!(Number(c.pending_renewal_price ?? 0) > 0))
      warnings.push("Prepared package has no price");
    if (!(Number(c.pending_renewal_total_visits ?? 0) > 0))
      warnings.push("Prepared package has no visit count");
  }
  return warnings;
}

export function buildRenewalDraft(
  c: DuesClient,
  dismissedFromPackageReview = false,
): DraftPlan {
  const amount = renewalAmountDue(c);
  const warnings = validateDraft(c, "renewal_due", amount, dismissedFromPackageReview);
  return {
    clientId: c.id,
    messageType: "renewal_due",
    phone: normalizePhone(c.phone),
    packageStartDate: c.pending_renewal_start_date ?? null,
    amountDue: amount,
    body: renderRenewalDueMessage({
      firstName: c.first_name,
      totalVisits: Number(c.pending_renewal_total_visits ?? 0),
      startDate: c.pending_renewal_start_date ?? "",
      amount,
    }),
    warnings,
    blocked: warnings.length > 0,
    requestKey: duesRequestKey("renewal_due", c),
  };
}

export function buildBalanceDraft(
  c: DuesClient & { package_start_date?: string | null },
  dismissedFromPackageReview = false,
): DraftPlan {
  const amount = totalOwed(c);
  const warnings = validateDraft(c, "balance_due", amount, dismissedFromPackageReview);
  return {
    clientId: c.id,
    messageType: "balance_due",
    phone: normalizePhone(c.phone),
    packageStartDate: c.package_start_date ?? null,
    amountDue: amount,
    body: renderBalanceDueMessage({ firstName: c.first_name, amount }),
    warnings,
    blocked: warnings.length > 0,
    requestKey: duesRequestKey("balance_due", c),
  };
}

/** Does an existing unsent draft materially differ from a freshly built one? */
export function draftChanged(
  existing: Pick<DuesMessage, "body" | "amount_due" | "status" | "blocked">,
  plan: Pick<DraftPlan, "body" | "amountDue" | "blocked">,
): boolean {
  return (
    existing.body !== plan.body ||
    Number(existing.amount_due) !== Number(plan.amountDue) ||
    existing.blocked !== plan.blocked
  );
}

export function statusLabel(d: Pick<DuesMessage, "status">): string {
  switch (d.status) {
    case "ready_not_sent":
      return "Draft — Not Sent";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "failed":
      return "Failed";
    case "replied":
      return "Replied";
    case "payment_received":
      return "Payment Received";
    default:
      return String(d.status);
  }
}

export const currentBalanceOwed = amountOwed;
export const priorBalanceOwed = previousOwed;
