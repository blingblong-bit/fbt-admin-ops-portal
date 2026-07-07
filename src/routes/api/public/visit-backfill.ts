import { createFileRoute } from "@tanstack/react-router";

// TEMPORARY one-off backfill endpoint. Auth: `x-diag-token` header must
// match ADMIN_DIAG_TOKEN. Two modes:
//   {"mode":"preview"} — sweep Square, parse seller_notes, return proposals.
//   {"mode":"apply", "proposals":[...]} — apply the exact proposals in one tx.

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-10-17";

function cleanToken(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/^[\s"'\u201C\u201D\u2018\u2019`]+|[\s"'\u201C\u201D\u2018\u2019`]+$/g, "")
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "");
}

type SquareBooking = {
  id: string;
  status?: string | null;
  start_at?: string | null;
  customer_id?: string | null;
  seller_note?: string | null;
};

type ClientRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  square_customer_id: string | null;
  visits_used: number | null;
  package_total_visits: number | null;
};

type Proposal = {
  client_id: string;
  name: string;
  square_customer_id: string;
  seller_note: string;
  note_start_at: string;
  parsed_n: number;
  parsed_m: number;
  match_method: "exact" | "first_line" | "slash";
  current_visits_used: number;
  current_total: number;
  proposed_visits_used: number;
  will_apply: boolean;
  skip_reason: string | null;
  flags: string[];
};

type Skipped = {
  client_id: string;
  name: string;
  square_customer_id: string;
  seller_note: string | null;
  reason: string;
};

const RE_EXACT = /^\s*(\d+)\s+of\s+(\d+)\s*$/i;
const RE_SLASH = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

function tryParse(
  note: string,
): { n: number; m: number; method: "exact" | "first_line" | "slash" } | null {
  const full = RE_EXACT.exec(note);
  if (full) return { n: Number(full[1]), m: Number(full[2]), method: "exact" };
  const firstLine = note.split("\n")[0].trim();
  if (firstLine !== note.trim()) {
    const fl = RE_EXACT.exec(firstLine);
    if (fl) return { n: Number(fl[1]), m: Number(fl[2]), method: "first_line" };
  }
  const sl = RE_SLASH.exec(note);
  if (sl) return { n: Number(sl[1]), m: Number(sl[2]), method: "slash" };
  const slFirst = RE_SLASH.exec(firstLine);
  if (slFirst) return { n: Number(slFirst[1]), m: Number(slFirst[2]), method: "slash" };
  return null;
}

async function loadClients() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const all: ClientRow[] = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, first_name, last_name, square_customer_id, visits_used, package_total_visits")
      .not("square_customer_id", "is", null)
      .range(from, from + step - 1);
    if (error) throw new Error(`db error: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as ClientRow[]));
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function sweepLatestNote(
  token: string,
  linkedCustomerIds: Set<string>,
): Promise<Map<string, { seller_note: string | null; start_at: string }>> {
  const latest = new Map<string, { seller_note: string | null; start_at: string }>();

  const consume = (bookings: SquareBooking[]) => {
    for (const b of bookings) {
      if (!b.customer_id || !linkedCustomerIds.has(b.customer_id) || !b.start_at) continue;
      const prev = latest.get(b.customer_id);
      if (!prev || b.start_at > prev.start_at) {
        latest.set(b.customer_id, { seller_note: b.seller_note ?? null, start_at: b.start_at });
      }
    }
  };

  // Upcoming pass (default range from "now" forward)
  {
    let cursor: string | undefined;
    for (let p = 0; p < 50; p++) {
      const url = new URL(`${SQUARE_BASE}/v2/bookings`);
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
      });
      if (!r.ok) break;
      const j = (await r.json()) as { bookings?: SquareBooking[]; cursor?: string };
      consume(j.bookings ?? []);
      cursor = j.cursor;
      if (!cursor) break;
    }
  }

  // Past pass: iterate month-windows backwards.
  const now = new Date();
  const MONTHS_BACK = 30;
  for (let m = 0; m < MONTHS_BACK; m++) {
    const maxD = new Date(now);
    maxD.setUTCMonth(maxD.getUTCMonth() - m);
    const minD = new Date(maxD);
    minD.setUTCMonth(minD.getUTCMonth() - 1);
    const startMax = maxD.toISOString();
    const startMin = minD.toISOString();
    let cursor: string | undefined;
    for (let p = 0; p < 50; p++) {
      const url = new URL(`${SQUARE_BASE}/v2/bookings`);
      url.searchParams.set("limit", "200");
      url.searchParams.set("start_at_min", startMin);
      url.searchParams.set("start_at_max", startMax);
      if (cursor) url.searchParams.set("cursor", cursor);
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
      });
      if (!r.ok) break;
      const j = (await r.json()) as { bookings?: SquareBooking[]; cursor?: string };
      consume(j.bookings ?? []);
      cursor = j.cursor;
      if (!cursor) break;
    }
  }

  return latest;
}

type PreviewBody = { mode: "preview" };
type ApplyBody = { mode: "apply"; proposals: Proposal[] };
type Body = PreviewBody | ApplyBody;

export const Route = createFileRoute("/api/public/visit-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ADMIN_DIAG_TOKEN;
        if (!expected) return new Response("no token configured", { status: 500 });
        if (request.headers.get("x-diag-token") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const body = (await request.json()) as Body;

        if (body.mode === "preview") {
          const token = cleanToken(process.env.SQUARE_PRODUCTION_ACCESS_TOKEN);
          if (!token) return new Response("no square token", { status: 500 });

          const clients = await loadClients();
          const byCustomer = new Map<string, ClientRow>();
          for (const c of clients) {
            if (c.square_customer_id) byCustomer.set(c.square_customer_id, c);
          }

          const latest = await sweepLatestNote(token, new Set(byCustomer.keys()));

          const proposals: Proposal[] = [];
          const skipped: Skipped[] = [];
          const methodCounts = { exact: 0, first_line: 0, slash: 0 };

          for (const [cid, info] of latest) {
            const client = byCustomer.get(cid);
            if (!client) continue;
            const name = `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim();
            const note = info.seller_note;
            if (note == null || note.trim() === "") {
              skipped.push({
                client_id: client.id,
                name,
                square_customer_id: cid,
                seller_note: note,
                reason: "no visit count found (blank)",
              });
              continue;
            }
            const parsed = tryParse(note);
            if (!parsed) {
              skipped.push({
                client_id: client.id,
                name,
                square_customer_id: cid,
                seller_note: note,
                reason: "no visit count found",
              });
              continue;
            }

            const currentUsed = Number(client.visits_used ?? 0);
            const currentTotal = Number(client.package_total_visits ?? 0);
            const flags: string[] = [];
            if (parsed.m !== currentTotal) flags.push(`M mismatch (note=${parsed.m}, hub=${currentTotal})`);

            let willApply = true;
            let skipReason: string | null = null;
            if (parsed.n === currentUsed) {
              willApply = false;
              skipReason = "no change";
            } else if (parsed.n > currentTotal) {
              willApply = false;
              skipReason = `parsed N (${parsed.n}) exceeds current package total (${currentTotal})`;
            } else if (parsed.n < 0) {
              willApply = false;
              skipReason = "negative N";
            }

            methodCounts[parsed.method]++;

            proposals.push({
              client_id: client.id,
              name,
              square_customer_id: cid,
              seller_note: note,
              note_start_at: info.start_at,
              parsed_n: parsed.n,
              parsed_m: parsed.m,
              match_method: parsed.method,
              current_visits_used: currentUsed,
              current_total: currentTotal,
              proposed_visits_used: parsed.n,
              will_apply: willApply,
              skip_reason: skipReason,
              flags,
            });
          }

          const willApply = proposals.filter((p) => p.will_apply);
          return Response.json({
            summary: {
              linked_clients: clients.length,
              clients_with_note: latest.size,
              parsed: proposals.length,
              parsed_by_method: methodCounts,
              unparsed_skipped: skipped.length,
              proposals_will_apply: willApply.length,
              proposals_no_change: proposals.filter((p) => p.skip_reason === "no change").length,
              proposals_exceeds_total: proposals.filter((p) => p.skip_reason?.startsWith("parsed N")).length,
              proposals_with_M_mismatch: proposals.filter((p) => p.flags.length > 0).length,
            },
            proposals,
            skipped_unparsed: skipped,
          });
        }

        if (body.mode === "apply") {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const applying = body.proposals.filter((p) => p.will_apply);
          if (applying.length === 0) return Response.json({ applied: 0, note: "nothing to apply" });

          // Build one SQL statement with a VALUES table so all updates run in one tx.
          const values = applying
            .map(
              (p) =>
                `('${p.client_id.replace(/'/g, "''")}'::uuid, ${p.proposed_visits_used}::int)`,
            )
            .join(",");
          const sql = `
            with v(id, new_used) as (values ${values})
            update public.clients c
               set visits_used = v.new_used
              from v
             where c.id = v.id
               and c.visits_used is distinct from v.new_used
          returning c.id, c.visits_used;`;

          const { data, error } = await supabaseAdmin.rpc("exec_sql_admin", { sql });
          if (error) {
            // Fallback: apply row-by-row when no RPC exists (there isn't one here).
            let applied = 0;
            const failures: Array<{ client_id: string; error: string }> = [];
            for (const p of applying) {
              const { error: uerr } = await supabaseAdmin
                .from("clients")
                .update({ visits_used: p.proposed_visits_used })
                .eq("id", p.client_id);
              if (uerr) failures.push({ client_id: p.client_id, error: uerr.message });
              else applied++;
            }
            return Response.json({
              applied,
              failed: failures.length,
              failures,
              mode: "row-by-row (no exec_sql_admin RPC)",
            });
          }
          return Response.json({ applied: (data as unknown[])?.length ?? applying.length, rpc: true });
        }

        return new Response("bad mode", { status: 400 });
      },
    },
  },
});
