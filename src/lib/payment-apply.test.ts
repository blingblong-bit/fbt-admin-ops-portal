import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyPaymentOnce } from "./payment-apply";

/**
 * Minimal chain-mock for the exact supabase-js call shapes used inside
 * applyPaymentOnce. We do NOT try to mimic the whole client — only the
 * three query shapes the function actually uses:
 *
 *   1) from("client_activities").select().eq().contains().limit()
 *      -> idempotency guard: returns { data, error }
 *   2) from("clients").select().eq().single()
 *      -> returns { data, error }
 *   3) from("clients").update().eq()
 *      -> returns { error }
 *   4) from("client_activities").insert()
 *      -> returns { error }
 */
type ClientRow = { amount_paid: number | null; package_price: number | null };

type MockState = {
  // idempotency guard result (existing activity rows) per squarePaymentId
  existingActivityForPayment: Set<string>;
  client: ClientRow;
  // spies / recorded writes
  updates: Array<{ table: string; values: Record<string, unknown>; eqId: string }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  // failure injection
  failActivityInsert?: boolean;
  failGuardSelect?: boolean;
};

function makeSupabaseMock(state: MockState) {
  const from = vi.fn((table: string) => {
    if (table === "client_activities") {
      return {
        // guard: .select().eq().contains().limit()
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            contains: (_col2: string, payload: { square_payment_id: string }) => ({
              limit: async (_n: number) => {
                if (state.failGuardSelect) {
                  return { data: null, error: { message: "boom" } };
                }
                const hit = state.existingActivityForPayment.has(payload.square_payment_id);
                return { data: hit ? [{ id: "act-1" }] : [], error: null };
              },
            }),
          }),
        }),
        // .insert(...)
        insert: async (values: Record<string, unknown>) => {
          if (state.failActivityInsert) {
            return { error: { message: "activity insert failed" } };
          }
          state.inserts.push({ table, values });
          const md = values.metadata as { square_payment_id?: string } | undefined;
          if (md?.square_payment_id) state.existingActivityForPayment.add(md.square_payment_id);
          return { error: null };
        },
      };
    }
    if (table === "clients") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            single: async () => ({ data: { ...state.client }, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            state.updates.push({ table, values, eqId: id });
            if (typeof values.amount_paid === "number") {
              state.client.amount_paid = values.amount_paid;
            }
            return { error: null };
          },
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from } as unknown as Parameters<typeof applyPaymentOnce>[0];
}

const baseArgs = {
  clientId: "client-1",
  squarePaymentId: "sq_pay_1",
  amountCents: 5000, // $50
  matchMethod: "square_customer_id",
} as const;

describe("applyPaymentOnce", () => {
  let state: MockState;

  beforeEach(() => {
    state = {
      existingActivityForPayment: new Set(),
      client: { amount_paid: 100, package_price: 300 },
      updates: [],
      inserts: [],
    };
  });

  it("applies a normal payment: credits the amount and writes an activity marker", async () => {
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, { ...baseArgs });

    expect(result).toEqual({ credited: true, appliedAmount: 50, alreadyApplied: false });
    // amount_paid moved 100 -> 150
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      table: "clients",
      values: { amount_paid: 150 },
      eqId: "client-1",
    });
    // idempotency marker inserted with the square_payment_id
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].values).toMatchObject({
      client_id: "client-1",
      activity_type: "payment",
    });
    const md = state.inserts[0].values.metadata as Record<string, unknown>;
    expect(md.square_payment_id).toBe("sq_pay_1");
    expect(md.applied_amount).toBe(50);
    expect(md.match_method).toBe("square_customer_id");
  });

  it("does NOT double-apply when the same webhook event is delivered twice", async () => {
    const supabase = makeSupabaseMock(state);

    const first = await applyPaymentOnce(supabase, { ...baseArgs });
    expect(first.credited).toBe(true);
    expect(state.client.amount_paid).toBe(150);

    // Second delivery for the same square_payment_id
    const second = await applyPaymentOnce(supabase, { ...baseArgs });

    expect(second).toEqual({ credited: false, appliedAmount: 0, alreadyApplied: true });
    // amount_paid unchanged after the second call
    expect(state.client.amount_paid).toBe(150);
    // no additional update, no additional activity row
    expect(state.updates).toHaveLength(1);
    expect(state.inserts).toHaveLength(1);
  });

  it("caps amount_paid at package_price when the payment would overpay", async () => {
    // Client owes $50 ($250 paid of $300). Incoming payment is $200.
    state.client = { amount_paid: 250, package_price: 300 };
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, {
      ...baseArgs,
      amountCents: 20000, // $200
    });

    // Only $50 of headroom is applied; the rest is dropped by the cap.
    expect(result).toEqual({ credited: true, appliedAmount: 50, alreadyApplied: false });
    expect(state.client.amount_paid).toBe(300);
    expect(state.updates[0].values).toMatchObject({ amount_paid: 300 });

    // Activity still records the original $200 payment amount and the actual $50 applied.
    const md = state.inserts[0].values.metadata as Record<string, unknown>;
    expect(md.amount).toBe(200);
    expect(md.applied_amount).toBe(50);
  });

  it("applies correctly to a client with no existing amount_paid (null or 0)", async () => {
    // Simulate a fresh client with amount_paid = null.
    state.client = { amount_paid: null, package_price: 400 };
    const supabase = makeSupabaseMock(state);

    const result = await applyPaymentOnce(supabase, {
      ...baseArgs,
      amountCents: 12500, // $125
    });

    expect(result).toEqual({ credited: true, appliedAmount: 125, alreadyApplied: false });
    expect(state.updates[0].values).toMatchObject({ amount_paid: 125 });
    const md = state.inserts[0].values.metadata as Record<string, unknown>;
    expect(md.amount).toBe(125);
    expect(md.applied_amount).toBe(125);
  });
});
