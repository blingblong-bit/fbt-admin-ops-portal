import { describe, expect, it, vi } from "vitest";
import { authorizeCron, handleActivationTick, safeEqual } from "./activation-tick.server";

const SECRET = "s".repeat(40);
const PUBLIC_KEY = "sb_publishable_test_key";
const req = (headers: Record<string, string> = {}, body: unknown = {}) =>
  new Request("http://x/api/public/renewal-activation-tick", { method: "POST", headers, body: JSON.stringify(body) });
function deps(env: Record<string, string | undefined>, enabled = false) {
  const loadAdmin = vi.fn(async () => ({}));
  const runSweep = vi.fn(async (_a: unknown, _t: string, o: { apply: boolean }) => ({
    enabled, wrote: o.apply && enabled, sinceYmd: "2026-10-24", squareError: null, counts: {}, rows: [],
  }));
  return { env: { SQUARE_PRODUCTION_ACCESS_TOKEN: "sq", SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY, ...env }, loadAdmin, runSweep };
}

describe("renewal activation endpoint authorization", () => {
  const rejected: [string, Record<string, string>][] = [
    ["no header", {}],
    ["wrong secret", { authorization: `Bearer ${"t".repeat(40)}` }],
    ["public app key as apikey", { apikey: PUBLIC_KEY }],
    ["public app key as bearer", { authorization: `Bearer ${PUBLIC_KEY}` }],
    ["user session token", { authorization: "Bearer eyJhbGciOi.user.jwt" }],
    ["secret without Bearer", { authorization: SECRET }],
  ];
  for (const [name, h] of rejected) {
    it(`rejects ${name} with 403 and touches neither Square nor the database (even apply)`, async () => {
      const d = deps({ SQUARE_ACTIVATION_CRON_SECRET: SECRET });
      const r = await handleActivationTick(req(h, { dryRun: false }), d);
      expect(r.status).toBe(403);
      expect(d.loadAdmin).not.toHaveBeenCalled();
      expect(d.runSweep).not.toHaveBeenCalled();
    });
  }
  it("fails closed when the secret is not configured, even with a matching-looking header", async () => {
    for (const s of [undefined, "", "short"]) {
      const d = deps({ SQUARE_ACTIVATION_CRON_SECRET: s });
      const r = await handleActivationTick(req({ authorization: `Bearer ${s ?? ""}` }), d);
      expect(r.status).toBe(403);
      expect(d.runSweep).not.toHaveBeenCalled();
    }
  });
  it("valid secret runs the sweep; writes stay off while auto activation is disabled", async () => {
    const d = deps({ SQUARE_ACTIVATION_CRON_SECRET: SECRET }, false);
    const r = await handleActivationTick(req({ authorization: `Bearer ${SECRET}` }), d);
    expect(r.status).toBe(200);
    expect(d.runSweep).toHaveBeenCalledOnce();
    expect((await r.json()).wrote).toBe(false);
  });
  it("dryRun:true never asks the sweep to apply", async () => {
    const d = deps({ SQUARE_ACTIVATION_CRON_SECRET: SECRET }, true);
    await handleActivationTick(req({ authorization: `Bearer ${SECRET}` }, { dryRun: true }), d);
    expect(d.runSweep.mock.calls[0][2]).toEqual({ apply: false });
  });
  it("response never contains the secret", async () => {
    const d = deps({ SQUARE_ACTIVATION_CRON_SECRET: SECRET });
    const r = await handleActivationTick(req({ authorization: `Bearer ${SECRET}` }), d);
    expect(await r.text()).not.toContain(SECRET);
  });
  it("safeEqual / authorizeCron basics", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(authorizeCron(req({ authorization: `bearer ${SECRET}` }), SECRET)).toBe(true);
  });
});
