import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ middleware() { return this; }, inputValidator() { return this; }, handler(fn: unknown) { return fn; } }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { cancelPendingRenewal } from "./schedule.functions";

const rpc = vi.fn();
const invoke = cancelPendingRenewal as unknown as (input: unknown) => Promise<{ ok: boolean; movedToCurrent: number }>;
const input = { data: { clientId: "krislyn" }, context: { userId: "actor", supabase: { rpc } } };

describe("prepared cancellation authenticated transaction", () => {
  beforeEach(() => rpc.mockReset());
  it("uses the atomic audited cancellation and never moves recognized funds", async () => {
    rpc.mockResolvedValue({ data: { ok: true, changed: true, movedToCurrent: 0 }, error: null });
    expect(await invoke(input)).toEqual({ ok: true, movedToCurrent: 0 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cancel_prepared_renewal", { p_client_id: "krislyn" });
  });
  it("does not report success when prepaid reconciliation blocks cancellation", async () => {
    rpc.mockResolvedValue({ error: { message: "Prepaid funds require reconciliation" } });
    await expect(invoke(input)).rejects.toThrow("Prepaid funds require reconciliation");
  });
  it("does not report success for an already-started corrected package", async () => {
    rpc.mockResolvedValue({ error: { message: "This corrected package has already started" } });
    await expect(invoke(input)).rejects.toThrow("already started");
  });
  it("surfaces staff authorization failures", async () => {
    rpc.mockResolvedValue({ error: { message: "Only staff can cancel prepared renewals" } });
    await expect(invoke(input)).rejects.toThrow("Only staff");
  });
  it("supports idempotent replay without money movement", async () => {
    rpc.mockResolvedValue({ data: { ok: true, changed: false, movedToCurrent: 0 }, error: null });
    expect((await invoke(input)).movedToCurrent).toBe(0);
  });
});