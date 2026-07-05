import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyPaymentOnce } from "./payment-apply";

/**
 * `applyPaymentOnce` now delegates to the Postgres function
 * `apply_square_payment` via `supabaseAdmin.rpc(...)`. The mock below emulates
 * that RPC's transactional behavior:
 *
 *   - a per-client async mutex simulates `SELECT ... FOR UPDATE` on the client
 *     row, serializing concurrent calls for the same client
 *   - inside the "transaction" we check the idempotency set, cap the applied
 *     amount at package_price, mutate amount_paid, and record the activity
 *   - returns `[{ newly_applied, applied_amount }]` like a real Postgres row set
 */
type ClientRow = { amount_paid: number | null; package_price: number | null };

type ActivityRow = {
  client_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;
};

type MockState = {
  // one client for these tests (keyed by clientId)
  clientId: string;
  client: ClientRow;
  // square_payment_ids already recorded as activities
  recordedPayments: Set<string>;
  activities: ActivityRow[];
  // failure injection
  failRpc?: boolean;
  // optional hook to inspect / delay individual rpc invocations
  onRpcEnter?: (paymentId: string) => Promise<void> | void;
};

type RpcArgs = {
  p_client_id: string;
  p_square_payment_id: string;
  p_amount_cents: number;
  p_match_method: string | null;
  p_manual_resolution?: boolean;
};

function makeSupabaseMock(state: MockState) {
  // Per-client mutex — models the row lock taken by SELECT ... FOR UPDATE.
  const locks = new Map<string, Promise<void>>();
  async function withRowLock<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(clientId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    locks.set(clientId, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const rpc = vi.fn(async (name: string, args: RpcArgs) => {
    if (name !== "apply_square_payment") {
      throw new Error(`unexpected rpc: ${name}`);
    }
    if (state.failRpc) {
      return { data: null, error: { message: "rpc boom" } };
    }

    return withRowLock(args.p_client_id, async () => {
      if (state.onRpcEnter) await state.onRpcEnter(args.p_square_payment_id);

      // Idempotency check (inside the lock, like the SQL function).
      if (state.recordedPayments.has(args.p_square_payment_id)) {
        return {
          data: [{ newly_applied: false, applied_amount: 0 }],
          error: null,
        };
      }

      const amountDollars = args.p_amount_cents / 100;
      const currentPaid = Number(state.client.amount_paid ?? 0);
      const price = Number(state.client.package_price ?? 0);
      const newPaid =
        price > 0 ? Math.min(price, currentPaid + amountDollars) : currentPaid + amountDollars;
      const applied = Math.max(0, newPaid - currentPaid);

      state.client.amount_paid = newPaid;

      const metadata: Record<string, unknown> = {
        source: "square",
        square_payment_id: args.p_square_payment_id,
        amount: amountDollars,
        applied_amount: applied,
        match_method: args.p_match_method,
      };
      if (args.p_manual_resolution) metadata.manual_resolution = true;

      state.activities.push({
        client_id: args.p_client_id,
        activity_type: "payment",
        description: `Square payment synced — $${amountDollars.toFixed(2)}`,
        metadata,
      });
      state.recordedPayments.add(args.p_square_payment_id);

      return {
        data: [{ newly_applied: true, applied_amount: applied }],
        error: null,
      };
    });
  });

  return { rpc } as unknown as Parameters<typeof applyPaymentOnce>[0];
}

const baseArgs = {
  clientId: "client-1",
  squarePaymentId: "sq_pay_1",
  amountCents: 5000, // $50
  matchMethod: "square_customer_id",
} as const;

describe("applyPaymentOnce (via apply_square_payment RPC)", () => {
  let state: MockState;

  beforeEach(() => {
    state = {
      clientId: "client-1",
      client: { amount_paid: 100, package_price: 300 },
      recordedPayments: new Set(),
      activities: [],
    };
  });

  it("applies a normal payment: credits the amount and records an activity", async () => {
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, { ...baseArgs });

    expect(result).toEqual({ credited: true, appliedAmount: 50, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(150);
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      client_id: "client-1",
      activity_type: "payment",
    });
    expect(state.activities[0].metadata).toMatchObject({
      square_payment_id: "sq_pay_1",
      applied_amount: 50,
      match_method: "square_customer_id",
    });
  });

  it("does NOT double-apply when the same webhook event is delivered twice", async () => {
    const supabase = makeSupabaseMock(state);

    const first = await applyPaymentOnce(supabase, { ...baseArgs });
    expect(first.credited).toBe(true);
    expect(state.client.amount_paid).toBe(150);

    const second = await applyPaymentOnce(supabase, { ...baseArgs });

    expect(second).toEqual({ credited: false, appliedAmount: 0, alreadyApplied: true });
    expect(state.client.amount_paid).toBe(150);
    expect(state.activities).toHaveLength(1);
  });

  it("caps amount_paid at package_price when the payment would overpay", async () => {
    state.client = { amount_paid: 250, package_price: 300 };
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, {
      ...baseArgs,
      amountCents: 20000, // $200
    });

    expect(result).toEqual({ credited: true, appliedAmount: 50, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(300);
    expect(state.activities[0].metadata).toMatchObject({ amount: 200, applied_amount: 50 });
  });

  it("applies correctly to a client with no existing amount_paid (null)", async () => {
    state.client = { amount_paid: null, package_price: 400 };
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, {
      ...baseArgs,
      amountCents: 12500, // $125
    });

    expect(result).toEqual({ credited: true, appliedAmount: 125, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(125);
    expect(state.activities[0].metadata).toMatchObject({ amount: 125, applied_amount: 125 });
  });

  it("applies partial payments sequentially: two $100 credits on a $375 package", async () => {
    state.client = { amount_paid: 0, package_price: 375 };
    const supabase = makeSupabaseMock(state);

    // First $100 payment
    const first = await applyPaymentOnce(supabase, {
      ...baseArgs,
      squarePaymentId: "sq_pay_100a",
      amountCents: 10000,
    });
    expect(first).toEqual({ credited: true, appliedAmount: 100, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(100);
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0].metadata).toMatchObject({
      square_payment_id: "sq_pay_100a",
      applied_amount: 100,
    });

    // Second $100 payment
    const second = await applyPaymentOnce(supabase, {
      ...baseArgs,
      squarePaymentId: "sq_pay_100b",
      amountCents: 10000,
    });
    expect(second).toEqual({ credited: true, appliedAmount: 100, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(200);
    expect(state.activities).toHaveLength(2);
    expect(state.activities[1].metadata).toMatchObject({
      square_payment_id: "sq_pay_100b",
      applied_amount: 100,
    });
  });

  it("serializes concurrent calls for the same square_payment_id — exactly one credit wins", async () => {
    state.client = { amount_paid: 100, package_price: 300 };

    // Force interleaving: hold the first RPC entry until the second has started,
    // so both would race past a naive read-modify-write. The per-client lock
    // (SELECT ... FOR UPDATE) must still serialize them.
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let seen = 0;
    state.onRpcEnter = async () => {
      seen += 1;
      if (seen === 1) {
        // First call parks briefly to give the second call a chance to enter.
        await firstEntered;
      }
    };

    const supabase = makeSupabaseMock(state);

    const p1 = applyPaymentOnce(supabase, { ...baseArgs });
    const p2 = applyPaymentOnce(supabase, { ...baseArgs });

    // Let the second call queue up on the row lock, then release the first.
    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();

    const [r1, r2] = await Promise.all([p1, p2]);

    const results = [r1, r2];
    const applied = results.filter((r) => r.alreadyApplied === false);
    const skipped = results.filter((r) => r.alreadyApplied === true);

    expect(applied).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(applied[0]).toEqual({ credited: true, appliedAmount: 50, alreadyApplied: false });
    expect(skipped[0]).toEqual({ credited: false, appliedAmount: 0, alreadyApplied: true });

    // Only one credit lands on the client, and only one activity row is written.
    expect(state.client.amount_paid).toBe(150);
    expect(state.activities).toHaveLength(1);
  });
});
