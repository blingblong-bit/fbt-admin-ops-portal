// Renewal-activation cron handler. Only a caller presenting the private
// SQUARE_ACTIVATION_CRON_SECRET as "Authorization: Bearer <secret>" gets in;
// everything else (no header, public app key, user tokens) is rejected before
// any Square or database work. Missing secret = closed. Never logs the secret.

export const CRON_SECRET_ENV = "SQUARE_ACTIVATION_CRON_SECRET";

/** Constant-time string compare (no early exit on first mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function authorizeCron(request: Request, secret: string | undefined): boolean {
  const s = (secret ?? "").trim();
  if (s.length < 32) return false; // fail closed: unset or too weak
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return safeEqual(m[1].trim(), s);
}

type SweepResult = {
  enabled: boolean; wrote: boolean; sinceYmd: string; squareError: string | null;
  counts: Record<string, number>; rows: { applied?: boolean; error?: string }[];
};
export type TickDeps = {
  env: Record<string, string | undefined>;
  loadAdmin: () => Promise<unknown>;
  runSweep: (admin: unknown, token: string, opts: { apply: boolean }) => Promise<SweepResult>;
};

export async function handleActivationTick(request: Request, deps: TickDeps): Promise<Response> {
  if (!authorizeCron(request, deps.env[CRON_SECRET_ENV])) return new Response("forbidden", { status: 403 });
  const token = (deps.env.SQUARE_PRODUCTION_ACCESS_TOKEN ?? "").replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
  if (!token) return new Response("no square token", { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };
  const admin = await deps.loadAdmin();
  // Writes still require SQUARE_AUTO_ACTIVATION_ENABLED=true inside the sweep.
  const r = await deps.runSweep(admin, token, { apply: body.dryRun !== true });
  return Response.json({
    enabled: r.enabled, wrote: r.wrote, sinceYmd: r.sinceYmd, squareError: r.squareError, counts: r.counts,
    applied: r.rows.filter((x) => x.applied).length, errors: r.rows.filter((x) => x.error).length,
  });
}
