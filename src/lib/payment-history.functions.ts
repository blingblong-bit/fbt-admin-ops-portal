import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Same clinic timezone / week logic as schedule.functions.ts. Duplicated
// intentionally to keep this module small and independently importable.
const CLINIC_TZ = "America/Chicago";

function ymdInTz(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tzOffsetMinutes(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) if (p.type !== "literal") map[p.type] = p.value;
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return (asUTC - d.getTime()) / 60000;
}

function ymdLocalToInstant(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const off = tzOffsetMinutes(new Date(utcMidnight));
  return new Date(utcMidnight - off * 60000);
}

function ymdWeekday(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysYmd(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type PaymentHistoryEntry = {
  id: string;
  client_id: string;
  client_name: string;
  description: string;
  created_at: string;
  amount: number | null;
  applied_amount: number | null;
  square_payment_id: string | null;
  match_method: string | null;
};

export type PaymentHistoryWeek = {
  week_start: string;
  week_end: string;
  weeks_ago: number;
  total: number;
  entries: PaymentHistoryEntry[];
  error: string | null;
};

/**
 * Read-only list of Square payments recorded in client_activities for a
 * single clinic-local week (Monday–Sunday, America/Chicago). `weeks_ago`
 * is 0 for the current week, 1 for last week, etc. Admin-only.
 */
export const getPaymentHistoryWeek = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { weeks_ago: number }) => {
    const n = Number(d?.weeks_ago);
    if (!Number.isInteger(n) || n < 0 || n > 51) {
      throw new Error("weeks_ago must be an integer 0–51");
    }
    return { weeks_ago: n };
  })
  .handler(async ({ data, context }): Promise<PaymentHistoryWeek> => {
    const todayYmd = ymdInTz(new Date());
    const dow = ymdWeekday(todayYmd);
    const mondayOffset = (dow + 6) % 7;
    const thisWeekStart = addDaysYmd(todayYmd, -mondayOffset);
    const weekStartYmd = addDaysYmd(thisWeekStart, -7 * data.weeks_ago);
    const weekEndYmd = addDaysYmd(weekStartYmd, 6);

    const startIso = ymdLocalToInstant(weekStartYmd).toISOString();
    const endExclusiveIso = ymdLocalToInstant(addDaysYmd(weekEndYmd, 1)).toISOString();

    const { data: rows, error } = await context.supabase
      .from("client_activities")
      .select("id, client_id, description, metadata, created_at, clients:client_id(first_name, last_name)")
      .eq("activity_type", "payment")
      .eq("metadata->>source", "square")
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso)
      .order("created_at", { ascending: false });

    if (error) {
      return {
        week_start: weekStartYmd,
        week_end: weekEndYmd,
        weeks_ago: data.weeks_ago,
        total: 0,
        entries: [],
        error: error.message,
      };
    }

    let total = 0;
    const entries: PaymentHistoryEntry[] = (rows ?? []).map((r) => {
      const meta = (r as { metadata: Record<string, unknown> | null }).metadata ?? {};
      const amount =
        typeof meta.amount === "number"
          ? meta.amount
          : meta.amount != null
            ? Number(meta.amount)
            : null;
      const appliedAmount =
        typeof meta.applied_amount === "number"
          ? meta.applied_amount
          : meta.applied_amount != null
            ? Number(meta.applied_amount)
            : null;
      if (appliedAmount != null && !Number.isNaN(appliedAmount)) total += appliedAmount;
      else if (amount != null && !Number.isNaN(amount)) total += amount;
      const clientRel = (r as { clients: { first_name?: string | null; last_name?: string | null } | null }).clients;
      const name = clientRel
        ? [clientRel.first_name, clientRel.last_name].filter(Boolean).join(" ").trim() || "Unknown"
        : "Unknown";
      return {
        id: (r as { id: string }).id,
        client_id: (r as { client_id: string }).client_id,
        client_name: name,
        description: (r as { description: string }).description,
        created_at: (r as { created_at: string }).created_at,
        amount: amount != null && !Number.isNaN(amount) ? amount : null,
        applied_amount:
          appliedAmount != null && !Number.isNaN(appliedAmount) ? appliedAmount : null,
        square_payment_id:
          typeof meta.square_payment_id === "string" ? meta.square_payment_id : null,
        match_method: typeof meta.match_method === "string" ? meta.match_method : null,
      };
    });

    return {
      week_start: weekStartYmd,
      week_end: weekEndYmd,
      weeks_ago: data.weeks_ago,
      total,
      entries,
      error: null,
    };
  });
