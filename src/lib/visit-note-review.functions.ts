import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchSquareBookings, type SquareBooking } from "@/lib/schedule.functions";
import {
  buildSequence,
  detectNoteIssues,
  type NoteIssue,
  type NoteIssueKind,
} from "@/lib/square-visit-audit";

type Ctx = { supabase: any; userId: string };

export type NoteChip = { date: string; label: string | null };

export type VisitNoteReviewCard = {
  client_id: string;
  name: string;
  square_customer_id: string;
  hub: string;
  past: NoteChip[];
  future: NoteChip[];
  issues: NoteIssue[];
};

export type VisitNoteReview = {
  generated_at: string;
  checked: number;
  cards: VisitNoteReviewCard[];
  counts: Record<NoteIssueKind, number>;
  error: string | null;
};

const DAY = 86_400_000;

/** Read-only: derived live from Square appointments. Writes nothing anywhere. */
export const getVisitNoteReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VisitNoteReview> => {
    const ctx = context as unknown as Ctx;
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" }),
    ]);
    if (!isAdmin && !isSuper) throw new Error("Forbidden — admin access required");

    const counts: Record<NoteIssueKind, number> = {
      skipped: 0, stale_future: 0, backward: 0, same_day_conflict: 0, package_size: 0, missing_note: 0,
    };
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const empty = (error: string | null, checked = 0): VisitNoteReview => ({
      generated_at: nowIso, checked, cards: [], counts, error,
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

    const token = process.env.SQUARE_PRODUCTION_ACCESS_TOKEN;
    if (!token) return empty("Square access token is not configured", clients.length);

    // Square limits each bookings query to 31 days — fetch 30-day chunks.
    const start = nowMs - 180 * DAY;
    const end = nowMs + 90 * DAY;
    const chunks: [string, string][] = [];
    for (let s = start; s < end; s += 30 * DAY) {
      chunks.push([new Date(s).toISOString(), new Date(Math.min(s + 30 * DAY, end)).toISOString()]);
    }
    const results = await Promise.all(chunks.map(([a, b]) => fetchSquareBookings(token, a, b)));
    const failed = results.find((r) => r.error);
    if (failed) return empty(failed.error, clients.length);

    const byCustomer = new Map<string, SquareBooking[]>();
    const seen = new Set<string>();
    for (const r of results) {
      for (const b of r.bookings) {
        if (!b.customer_id || seen.has(b.id)) continue;
        seen.add(b.id);
        const list = byCustomer.get(b.customer_id) ?? [];
        list.push(b);
        byCustomer.set(b.customer_id, list);
      }
    }

    const cards: VisitNoteReviewCard[] = [];
    for (const c of clients) {
      const bookings = byCustomer.get(c.square_customer_id) ?? [];
      const seq = buildSequence(
        bookings.filter((b) => b.start_at).map((b) => ({
          id: b.id, start_at: b.start_at!, status: b.status,
          seller_note: b.seller_note, customer_note: b.customer_note,
        })),
        nowIso,
      );
      const issues = detectNoteIssues(seq);
      if (issues.length === 0) continue;
      for (const k of new Set(issues.map((i) => i.kind))) counts[k]++;
      const chip = (e: (typeof seq)[number]): NoteChip => ({
        date: e.date, label: e.note ? `${e.note.n}/${e.note.total}` : null,
      });
      cards.push({
        client_id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        square_customer_id: c.square_customer_id,
        hub: `${c.visits_used ?? 0}/${c.package_total_visits ?? 0}`,
        past: seq.filter((e) => e.past).slice(-4).map(chip),
        future: seq.filter((e) => !e.past).slice(0, 4).map(chip),
        issues,
      });
    }
    cards.sort((a, b) => a.name.localeCompare(b.name));
    return { generated_at: nowIso, checked: clients.length, cards, counts, error: null };
  });
