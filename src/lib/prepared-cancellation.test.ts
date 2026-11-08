import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelPreparedTransaction } from "./prepared-cancellation";

const rpc = vi.fn();
const invoke = (_input: unknown) => cancelPreparedTransaction("krislyn", rpc);
const input = {};

describe("prepared cancellation authenticated transaction", () => {
  beforeEach(() => rpc.mockReset());
  it("uses the atomic audited cancellation and never moves recognized funds", async () => {
    rpc.mockResolvedValue({ data: { ok: true, changed: true, movedToCurrent: 0 }, error: null });
    expect(await invoke(input)).toEqual({ ok: true, movedToCurrent: 0 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("krislyn");
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