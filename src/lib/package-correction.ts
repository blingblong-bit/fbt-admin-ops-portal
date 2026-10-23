// Pure rules for the admin "Correct package" panel. It never computes dues;
// it only turns a form into a safe patch for the existing audited edit tools.

export type PackageSnapshot = {
  package_name: string | null;
  package_total_visits: number;
  visits_used: number | null;
  package_price: number;
  amount_paid: number;
  package_start_date: string | null;
  pending_renewal_start_date: string | null;
  pending_renewal_total_visits: number | null;
  pending_renewal_price: number | null;
  pending_renewal_package_name: string | null;
};

export type CorrectionForm = {
  package_total_visits: number;
  visits_used: number;
  package_price: number;
  amount_paid: number;
  package_start_date: string | null;
  renewal_start_date: string | null;
  renewal_total_visits: number | null;
  renewal_price: number | null;
};

export type FieldChange = { field: string; label: string; before: unknown; after: unknown };

export type CorrectionPlan = {
  /** Patch for update_client_details (current package, one logged step). */
  packagePatch: Record<string, unknown>;
  /** New values for the existing prepared-renewal update, or null if unchanged. */
  renewal: { startYmd: string; totalVisits: number; price: number; packageName: string | null } | null;
  changes: FieldChange[];
  errors: string[];
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => Number(v ?? 0);

export function planCorrection(cur: PackageSnapshot, f: CorrectionForm): CorrectionPlan {
  const errors: string[] = [];
  const changes: FieldChange[] = [];
  const packagePatch: Record<string, unknown> = {};

  if (!Number.isInteger(f.package_total_visits) || f.package_total_visits < 1) errors.push("Package size must be at least 1 visit.");
  if (!Number.isInteger(f.visits_used) || f.visits_used < 0) errors.push("Visits used can't be negative.");
  else if (f.visits_used > f.package_total_visits) errors.push("Visits used can't be more than the package size.");
  if (!(f.package_price >= 0)) errors.push("Price can't be negative.");
  if (!(f.amount_paid >= 0)) errors.push("Paid can't be negative.");
  if (f.amount_paid > num(cur.amount_paid) + 0.001)
    errors.push("Paid can only be lowered here. To add money, record a payment or move an existing payment.");
  if (f.package_start_date && !YMD.test(f.package_start_date)) errors.push("Start date is not valid.");

  const pkg: [keyof PackageSnapshot & keyof CorrectionForm, string, boolean][] = [
    ["package_total_visits", "Package size", true],
    ["visits_used", "Visits used", true],
    ["package_price", "Price", true],
    ["amount_paid", "Paid on current package", true],
    ["package_start_date", "Start date", false],
  ];
  for (const [k, label, numeric] of pkg) {
    const before = cur[k];
    const after = f[k];
    const same = numeric ? num(before) === num(after) && (before !== null || after === null) : (before ?? null) === (after || null);
    if (!same) {
      packagePatch[k] = numeric ? num(after) : after || null;
      changes.push({ field: k, label, before, after: numeric ? num(after) : after || null });
    }
  }

  let renewal: CorrectionPlan["renewal"] = null;
  const hasRenewal = !!cur.pending_renewal_start_date;
  const touchedRenewal =
    (f.renewal_start_date ?? null) !== (cur.pending_renewal_start_date ?? null) ||
    num(f.renewal_total_visits) !== num(cur.pending_renewal_total_visits) ||
    num(f.renewal_price) !== num(cur.pending_renewal_price);
  if (touchedRenewal) {
    if (!hasRenewal) errors.push("There is no prepared renewal to edit. Use Pre-Renew to prepare one.");
    else if (!f.renewal_start_date || !YMD.test(f.renewal_start_date)) errors.push("Renewal start date is required (use Cancel to remove a renewal).");
    else if (!Number.isInteger(f.renewal_total_visits) || num(f.renewal_total_visits) < 1) errors.push("Renewal size must be at least 1 visit.");
    else if (!(num(f.renewal_price) >= 0)) errors.push("Renewal price can't be negative.");
    else {
      renewal = {
        startYmd: f.renewal_start_date,
        totalVisits: num(f.renewal_total_visits),
        price: num(f.renewal_price),
        packageName: cur.pending_renewal_package_name,
      };
      const r: [string, string, unknown, unknown][] = [
        ["renewal_start_date", "Renewal can start on or after", cur.pending_renewal_start_date, f.renewal_start_date],
        ["renewal_total_visits", "Renewal size", cur.pending_renewal_total_visits, num(f.renewal_total_visits)],
        ["renewal_price", "Renewal price", cur.pending_renewal_price, num(f.renewal_price)],
      ];
      for (const [field, label, before, after] of r)
        if (String(before ?? "") !== String(after ?? "") && num(before) !== num(after) || (typeof after === "string" && before !== after))
          changes.push({ field, label, before, after });
    }
  }

  return { packagePatch, renewal, changes, errors };
}

/** Square-linked vs hand-entered payments, from payment activity metadata. */
export function paymentSource(meta: Record<string, unknown> | null | undefined): "square" | "manual" {
  const ref = String(meta?.square_payment_id ?? "");
  return meta?.source === "square" && !ref.startsWith("manual:") ? "square" : "manual";
}
