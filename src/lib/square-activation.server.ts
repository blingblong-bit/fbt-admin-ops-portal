// Sweep: find prepared renewals Square has already started. Writes ONLY when
// SQUARE_AUTO_ACTIVATION_ENABLED === "true" and the caller asks to apply, and
// never for backlog/ambiguous clients. Activation goes through the existing
// locked renew_client_package (boundary key makes retries no-ops).
import { decideSquareActivation, type SquareActivationDecision } from "./square-activation";
import { buildSequence, detectNoteIssues } from "./square-visit-audit";
import { currentPositionUnreadable } from "./effective-visit-state";
import { renewClientPackage } from "./renewal.functions";

/** Default backlog cutoff: openers before this never auto-activate. */
export const DEFAULT_ACTIVATION_SINCE = "2026-10-24";

export type SweepRow = { client_id: string; name: string; decision: SquareActivationDecision; applied?: boolean; error?: string };

export async function runSquareActivationSweep(admin: any, token: string, opts: { apply: boolean }) {
  const enabled = process.env.SQUARE_AUTO_ACTIVATION_ENABLED === "true";
  const sinceYmd = process.env.SQUARE_AUTO_ACTIVATION_SINCE || DEFAULT_ACTIVATION_SINCE;
  const write = opts.apply && enabled;
  const { data: clients, error } = await admin
    .from("clients")
    .select("id, first_name, last_name, square_customer_id, pending_renewal_start_date, pending_renewal_total_visits, pending_renewal_price, pending_renewal_package_name")
    .is("deleted_at", null).neq("status", "archived").not("pending_renewal_start_date", "is", null);
  if (error) throw error;
  const { data: ovr, error: oe } = await admin.from("package_overrides").select("client_id, slot").is("cleared_at", null);
  if (oe) throw oe;
  const overridden = new Set(((ovr ?? []) as { client_id: string; slot: string }[]).filter((o) => o.slot !== "previous").map((o) => o.client_id));
  const { loadSquareBookingIndex } = await import("./effective-visit-state.server");
  const index = await loadSquareBookingIndex(token, 120, 1, { fresh: true });
  const rows: SweepRow[] = [];
  for (const c of (clients ?? []) as any[]) {
    const bks = index.error ? null : (c.square_customer_id ? index.byCustomer.get(c.square_customer_id) ?? [] : []);
    const seq = bks ? buildSequence(bks.filter((b: any) => b.start_at) as never, index.nowIso) : null;
    const decision = decideSquareActivation({
      client: c, seq, hasOverride: overridden.has(c.id), sinceYmd,
      currentUnreadable: seq ? currentPositionUnreadable(seq, detectNoteIssues(seq)) : false,
    });
    const row: SweepRow = { client_id: c.id, name: `${c.first_name} ${c.last_name}`, decision };
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
