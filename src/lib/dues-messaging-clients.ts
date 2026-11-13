import type { DuesClient } from "./dues-messaging";
import { applyOverridesToRows, type PackageOverride } from "./package-override";

type MessagingClient = DuesClient & { package_start_date: string | null };

const CLIENT_COLUMNS =
  "id, first_name, last_name, phone, package_name, package_total_visits, package_price, package_start_date, visits_used, amount_paid, previous_package_owed, payment_model, status, deleted_at, visit_tracking_mode, pending_renewal_start_date, pending_renewal_price, pending_renewal_total_visits, pending_renewal_package_name, pending_renewal_paid, sms_consent_at, sms_consent_source, sms_consent_recorded_by, sms_opted_out_at, sms_opt_out_source";

/** All messaging reads use the same audited effective package state as profiles.
 * Read-only; failure to read corrections must never fall back to raw prices.
 */
export async function loadDuesClients(
  supabase: any,
  options: { clientIds?: string[]; includeDeleted?: boolean } = {},
): Promise<MessagingClient[]> {
  if (options.clientIds?.length === 0) return [];
  let query = supabase.from("clients").select(CLIENT_COLUMNS);
  if (!options.includeDeleted) query = query.is("deleted_at", null);
  if (options.clientIds) query = query.in("id", options.clientIds);
  const { data: rows, error } = await query;
  if (error) throw error;
  const clients = (rows ?? []) as MessagingClient[];
  if (clients.length === 0) return [];

  const { data: overrides, error: overrideError } = await supabase
    .from("package_overrides")
    .select("*")
    .is("cleared_at", null)
    .in("client_id", clients.map((c) => c.id));
  if (overrideError) throw overrideError;
  return applyOverridesToRows(
    clients,
    (overrides ?? []) as (PackageOverride & { client_id: string })[],
  );
}