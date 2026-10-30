// Sweep: find prepared renewals Square has already started. Writes ONLY when
// SQUARE_AUTO_ACTIVATION_ENABLED === "true" and the caller asks to apply, and
// never for backlog/ambiguous clients. Activation goes through the existing
// locked renew_client_package (boundary key makes retries no-ops).
import { decideOverridePendingStart, decideSquareActivation, type SquareActivationDecision } from "./square-activation";
import { buildSequence, detectNoteIssues } from "./square-visit-audit";
import { currentPositionUnreadable } from "./effective-visit-state";
import { renewClientPackage } from "./renewal.functions";

/** Default backlog cutoff: openers before this never auto-activate. */
export const DEFAULT_ACTIVATION_SINCE = "2026-10-24";

export type SweepRow = { client_id: string; name: string; decision: SquareActivationDecision; applied?: boolean; error?: string; via?: "renewal" | "override" };

export async function runSquareActivationSweep(admin: any, token: string, opts: { apply: boolean; clientId?: string; manual?: boolean }) {
  const enabled = process.env.SQUARE_AUTO_ACTIVATION_ENABLED === "true";
  // Manual = a staff member clicked "Activate from Square" for ONE client:
  // same Square evidence rules, but the backlog cutoff and global flag don't apply.
  const manual = !!opts.manual && !!opts.clientId;
  const sinceYmd = manual ? "0000-01-01" : (process.env.SQUARE_AUTO_ACTIVATION_SINCE || DEFAULT_ACTIVATION_SINCE);
  const write = opts.apply && (enabled || manual);
  const { data: clients, error } = await admin
    .from("clients")
    .select("id, first_name, last_name, square_customer_id, package_total_visits, visits_used, package_price, amount_paid, package_start_date, previous_package_owed, pending_renewal_start_date, pending_renewal_total_visits, pending_renewal_price, pending_renewal_paid, pending_renewal_package_name")
    .is("deleted_at", null).neq("status", "archived").not("pending_renewal_start_date", "is", null);
  if (error) throw error;
  const { data: ovr, error: oe } = await admin.from("package_overrides").select("*").is("cleared_at", null);
  if (oe) throw oe;
  const ovrRows = (ovr ?? []) as any[];
  const overridden = new Set(ovrRows.filter((o) => o.slot !== "previous").map((o) => o.client_id));
  // Prepared packages held in an override may have no raw prepared row.
  const have = new Set(((clients ?? []) as any[]).map((c) => c.id));
  const extraIds = [...new Set(ovrRows.filter((o) => o.slot !== "previous" && !have.has(o.client_id)).map((o) => o.client_id))];
  if (extraIds.length) {
    const { data: more, error: me } = await admin.from("clients")
      .select("id, first_name, last_name, square_customer_id, package_total_visits, visits_used, package_price, amount_paid, package_start_date, previous_package_owed, pending_renewal_start_date, pending_renewal_total_visits, pending_renewal_price, pending_renewal_paid, pending_renewal_package_name")
      .is("deleted_at", null).neq("status", "archived").in("id", extraIds);
    if (me) throw me;
    (clients as any[]).push(...(more ?? []));
  }
  const { loadSquareBookingIndex } = await import("./effective-visit-state.server");
  const index = await loadSquareBookingIndex(token, 120, 1, { fresh: true });
  const rows: SweepRow[] = [];
  for (const c of (clients ?? []) as any[]) {
    if (opts.clientId && c.id !== opts.clientId) continue;
    const bks = index.error ? null : (c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : []);
    const seq = bks ? buildSequence(bks.filter((b: any) => b.start_at) as never, index.nowIso) : null;
    const currentUnreadable = seq ? currentPositionUnreadable(seq, detectNoteIssues(seq)) : false;
    const mine = ovrRows.filter((o) => o.client_id === c.id);
    if (overridden.has(c.id)) {
      // Admin financial/date-only figures: Square's start promotes them into
      // the next cycle atomically (raw fields untouched); visit counts stay manual.
      const d = decideOverridePendingStart({ client: c, overrides: mine, seq, currentUnreadable });
      const decision: SquareActivationDecision = d.kind === "activate" && d.startYmd < sinceYmd ? { ...d, kind: "backlog" } : d;
      const row: SweepRow = { client_id: c.id, name: `${c.first_name} ${c.last_name}`, decision, via: "override" };
      if (write && decision.kind === "activate" && d.figures) {
        const { error: re } = await admin.rpc("start_pending_override_from_square", {
          p_client_id: c.id, p_booking_id: decision.bookingId, p_start: decision.startYmd, p_total: decision.total, p_figures: d.figures,
        });
        if (re) row.error = re.message; else row.applied = true;
      }
      rows.push(row);
      continue;
    }
    const decision = decideSquareActivation({
      client: c, seq, hasOverride: overridden.has(c.id), sinceYmd, currentUnreadable,
    });
    const row: SweepRow = { client_id: c.id, name: `${c.first_name} ${c.last_name}`, decision, via: "renewal" };
    if (write && decision.kind === "activate") {
      try {
        await renewClientPackage(admin, {
          clientId: c.id, packageName: c.pending_renewal_package_name, totalVisits: decision.total,
          price: Number(c.pending_renewal_price ?? 0), startDate: decision.startYmd,
          source: "boundary_activation", bookingId: decision.bookingId, visitsUsed: decision.visitsUsed,
        });
        row.applied = true;
      } catch (e) {
        row.error = (e as Error).message; // e.g. boundary already renewed → safe no-op
      }
    }
    rows.push(row);
  }
  const count = (k: string) => rows.filter((r) => r.decision.kind === k).length;
  return {
    enabled, wrote: write, sinceYmd, squareError: index.error ?? null,
    counts: { activate: count("activate"), backlog: count("backlog"), ambiguous: count("ambiguous"), not_ready: count("not_ready"), skip: count("skip") },
    rows,
  };
}
