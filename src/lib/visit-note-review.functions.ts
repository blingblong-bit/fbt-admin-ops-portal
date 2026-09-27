import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSequence,
  detectNoteIssues,
  statusLabel,
  type NoteIssue,
  type NoteIssueKind,
} from "@/lib/square-visit-audit";

type Ctx = { supabase: any; userId: string };

export type NoteChip = { date: string; label: string | null; status: string | null };

export type VisitNoteReviewCard = {
  client_id: string;
  name: string;
  square_customer_id: string;
  hub: string;
  past: NoteChip[];
  future: NoteChip[];
  issues: NoteIssue[];
  fingerprint: string;
  confirmed: { reason: string | null; confirmed_at: string } | null;
};

export type VisitNoteReview = {
  generated_at: string;
  checked: number;
  cards: VisitNoteReviewCard[];
  confirmed: VisitNoteReviewCard[];
  counts: Record<NoteIssueKind, number>;
  error: string | null;
};

async function assertAdmin(ctx: Ctx) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("Forbidden — admin access required");
}

/** Stable snapshot of a client's Square bookings; any Square edit changes it. */
function fingerprintOf(bookings: { id: string; status?: string | null; seller_note?: string | null; customer_note?: string | null; start_at?: string | null }[]): string {
  const s = bookings
    .map((b) => `${b.id}|${b.start_at ?? ""}|${b.status ?? ""}|${b.seller_note ?? ""}|${b.customer_note ?? ""}`)
    .sort()
    .join("\n");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${bookings.length}:${h.toString(36)}`;
}

/** Read-only against Square. Only confirmations (review-list visibility) are stored. */
export const getVisitNoteReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fresh?: boolean } | undefined) => ({ fresh: !!d?.fresh }))
  .handler(async ({ context, data: input }): Promise<VisitNoteReview> => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);

    const counts: Record<NoteIssueKind, number> = {
      skipped: 0, stale_future: 0, future_after_complete: 0, backward: 0, same_day_conflict: 0, package_size: 0, missing_note: 0,
    };
    const nowIso = new Date().toISOString();
    const empty = (error: string | null, checked = 0): VisitNoteReview => ({
      generated_at: nowIso, checked, cards: [], confirmed: [], counts, error,
    });

    const clients: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.supabase
        .from("clients")
        .select("id, first_name, last_name, square_customer_id, visits_used, package_total_visits")
        .eq("status", "active")
        .is("deleted_at", null)
        .not("square_customer_id", "is", null)
        .order("created_at")
        .range(from, from + 999);
      if (error) return empty(error.message);
      clients.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const { data: confRows } = await ctx.supabase
      .from("visit_note_confirmations")
      .select("client_id, fingerprint, reason, confirmed_at");
    const confirmations = new Map<string, any>((confRows ?? []).map((r: any) => [r.client_id, r]));

    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return empty("Square access token is not configured", clients.length);

    const { loadSquareBookingIndex } = await import("@/lib/effective-visit-state.server");
    const index = await loadSquareBookingIndex(token, 180, 90, { fresh: input.fresh });
    if (index.error) return empty(index.error, clients.length);

    const cards: VisitNoteReviewCard[] = [];
    const confirmed: VisitNoteReviewCard[] = [];
    for (const c of clients) {
      const bookings = (index.byCustomer.get(c.square_customer_id) ?? []).filter((b) => b.start_at);
      const seq = buildSequence(
        bookings.map((b) => ({
          id: b.id, start_at: b.start_at!, status: b.status,
          seller_note: b.seller_note, customer_note: b.customer_note,
        })),
        index.nowIso,
      );
      const issues = detectNoteIssues(seq);
      if (issues.length === 0) continue;
      const fingerprint = fingerprintOf(bookings);
      const conf = confirmations.get(c.id);
      const isConfirmed = !!conf && conf.fingerprint === fingerprint;
      const chip = (e: (typeof seq)[number]): NoteChip => ({
        date: e.date, label: e.note ? `${e.note.n}/${e.note.total}` : null, status: statusLabel(e.status),
      });
      const card: VisitNoteReviewCard = {
        client_id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        square_customer_id: c.square_customer_id,
        hub: `${c.visits_used ?? 0}/${c.package_total_visits ?? 0}`,
        past: seq.filter((e) => e.past).slice(-4).map(chip),
        future: seq.filter((e) => !e.past).slice(0, 4).map(chip),
        issues,
        fingerprint,
        confirmed: isConfirmed ? { reason: conf.reason ?? null, confirmed_at: conf.confirmed_at } : null,
      };
      if (isConfirmed) {
        confirmed.push(card);
        continue;
      }
      for (const k of new Set(issues.map((i) => i.kind))) counts[k]++;
      cards.push(card);
    }
    cards.sort((a, b) => a.name.localeCompare(b.name));
    confirmed.sort((a, b) => a.name.localeCompare(b.name));
    return { generated_at: index.nowIso, checked: clients.length, cards, confirmed, counts, error: null };
  });

/** Hides a client from the review list until their Square bookings change. */
export const confirmVisitNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string; fingerprint: string; reason?: string | null }) => {
    if (!d?.client_id || !d?.fingerprint) throw new Error("client_id and fingerprint required");
    return { client_id: String(d.client_id), fingerprint: String(d.fingerprint), reason: d.reason ? String(d.reason).slice(0, 300) : null };
  })
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.from("visit_note_confirmations").upsert({
      client_id: data.client_id,
      fingerprint: data.fingerprint,
      reason: data.reason,
      confirmed_by: ctx.userId,
      confirmed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unconfirmVisitNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string }) => {
    if (!d?.client_id) throw new Error("client_id required");
    return { client_id: String(d.client_id) };
  })
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { error } = await ctx.supabase.from("visit_note_confirmations").delete().eq("client_id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
