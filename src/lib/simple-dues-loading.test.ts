import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepPreviousData, QueryClient } from "@tanstack/react-query";
import type { SquareBooking } from "./schedule.functions";

const harness = vi.hoisted(() => ({ db: {} as unknown, reader: vi.fn(), rpc:vi.fn(), started: [] as string[] }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain = {
      middleware: () => chain,
      inputValidator: () => chain,
      handler: (handler: (input: unknown) => unknown) => (input: { data: unknown }) => handler({ data: input.data, context: { supabase: harness.db, userId: "test-admin" } }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/schedule.functions", () => ({ fetchSquareBookings: harness.reader }));
import { getSimpleDues, simpleDuesQuery, saveSimpleDues } from "./simple-dues.functions";
import { invalidateFor } from "./simple-dues-cache";

const clientId = "00000000-0000-4000-8000-000000000001";
const packageRow = (price = 375) => ({ id: "package-one", client_id: clientId, visits: 8, price, started_on: "2026-11-24", source: "manual", square_payment_id: null, flagged_for_review: false, reviewed_at: null, note: null, created_at: "2026-11-24T01:00:00Z", deleted_at: null });
const rawBooking: SquareBooking = { id: "booking-one", customer_id: "square-one", start_at: "2026-11-24T15:00:00Z", status: "ACCEPTED", appointment_segments: [{ duration_minutes: 45 }] };
let packages = [packageRow()];
let receiptCents = 0;
let historyReceipts: {square_payment_id:string;client_id:string;amount_cents:number;currency:string;status:string;created_at:string;raw_event:null;buyer_email:null}[] = [];
let dismissals: {client_id:string;activity_type:string;created_at:string}[] = [];
let dismissalError: unknown = null;
let settingsGate: Promise<void> = Promise.resolve();
function db() {
  return { rpc:harness.rpc, from: (table: string) => {
    let completedOnly=false;
    const query = {
      select: () => query, eq: (key:string,value:unknown) => {if(key==="status"&&value==="COMPLETED")completedOnly=true;return query;}, order: () => query, gte: () => query, in: () => query,
      maybeSingle: () => run(), range: () => run(), then: (resolve: (value: unknown) => unknown) => run().then(resolve),
    };
    async function run() {
      harness.started.push(table);
      if(table === "client_activities" && dismissalError) return {data:null,error:dismissalError};
      if (table === "simple_dues_settings") await settingsGate;
      const data = table === "user_roles" ? [{ role: "admin" }]
        : table === "simple_dues_settings" ? { cutover_date: "2026-11-24" }
        : table === "clients" ? [{ id: clientId, first_name: "Example", last_name: "Client", square_customer_id: "square-one", status: "active", deleted_at: null }]
        : table === "simple_packages" ? packages
        : table === "client_activities" ? dismissals
        : table === "square_payments" ? [...(completedOnly?historyReceipts:[]),...(receiptCents?[{ square_payment_id: "receipt", client_id: clientId, amount_cents: receiptCents, currency: "USD", status: "COMPLETED", created_at: "2026-11-24T06:00:00Z", raw_event: null, buyer_email: null }]:[])]
        : [];
      return { data, error: null };
    }
    return query;
  } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T18:00:00Z"));
  vi.stubEnv("SQUARE_PRODUCTION_ACCESS_TOKEN", "test-token");
  harness.started = [];
  harness.reader.mockReset().mockResolvedValue({ bookings: [rawBooking], error: null });
  harness.rpc.mockReset().mockResolvedValue({data:1,error:null});
  packages = [packageRow()];
  receiptCents = 0;
  historyReceipts = [];
  dismissals = [];
  dismissalError = null;
  settingsGate = Promise.resolve();
  harness.db = db();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("simple Dues loading preserves all calculations", () => {
  it("retains seller and customer notes in the fetched booking projection", async () => {
    harness.reader.mockResolvedValue({bookings:[{...rawBooking,seller_note:"7 of 8",customer_note:"staff note"},{...rawBooking,id:"next",start_at:"2026-11-25T15:00:00Z",seller_note:null,customer_note:"8/8"}],error:null});
    const result=await getSimpleDues({data:{clientId,forceFresh:true}});
    expect(result.rows[0]?.upcomingVisits[0]).toMatchObject({label:"8/8",booking:{sellerNote:null,customerNote:"8/8"}});
    expect(result.rows[0]?.visitsLeft).toBe(1);
  });
  it("opening corrections reuse only the opening action and preserve date and the original nullable note", async()=>{
    await saveSimpleDues({data:{action:"opening",clientId,amount:0,date:"2026-11-24",note:null}});
    expect(harness.rpc.mock.calls).toEqual([["simple_import_openings",{_rows:[{client_id:clientId,amount:0,note:null}],_as_of:"2026-11-24"}]]);
    expect(harness.started).toEqual(["user_roles"]);
  });
  it("returns the November 16 $375 receipt as history without paying a $375 opening balance", async () => {
    historyReceipts=[{square_payment_id:"before-cutover",client_id:clientId,amount_cents:37500,currency:"USD",status:"COMPLETED",created_at:"2026-11-16T18:00:00Z",raw_event:null,buyer_email:null}];
    const result=await getSimpleDues({data:{clientId}});
    expect(result.payments).toEqual([]);
    expect(result.paymentHistory).toMatchObject([{id:"before-cutover",date:"2026-11-16",amountCents:37500}]);
    expect(result.lastPayments[clientId]).toEqual({date:"2026-11-16",amount:375});
    expect(result.rows[0]?.balance).toBe(375);
    expect(result.totalOwed).toBe(375);
  });
  it("a $375 eight-visit simple package with a $375 receipt has zero balance and one tracker", async () => {
    receiptCents = 37500;
    const result = await getSimpleDues({data:{clientId,forceFresh:true}});
    expect(result.rows[0]?.balance).toBe(0);
    expect(result.needsPackage).toHaveLength(0);
    expect(result.packageSummaries[clientId]).toMatchObject({package:{visits:8,price:375},visitsLeft:7});
    expect(result.payments).toMatchObject([{id:"receipt",amountCents:37500}]);
  });
  it("dismissed clients leave Needs a package without changing balances, and undo restores membership", async () => {
    packages = [];
    receiptCents = 10000;
    dismissals = [{client_id:clientId,activity_type:"package_review_dismissed",created_at:"2026-11-24T17:00:00Z"}];
    const dismissed = await getSimpleDues({data:{forceFresh:true}});
    expect(dismissed.needsPackage).toHaveLength(0);
    expect(dismissed.rows[0]?.balance).toBe(-100);
    dismissals.push({client_id:clientId,activity_type:"package_review_redo",created_at:"2026-11-24T17:30:00Z"});
    const undone = await getSimpleDues({data:{}});
    expect(undone.needsPackage.map(r=>r.client.id)).toEqual([clientId]);
    expect(undone.rows[0]?.balance).toBe(-100);
  });
  it("unreadable dismissals stop the review read rather than guessing", async () => {
    dismissalError = new Error("Review state unavailable");
    await expect(getSimpleDues({data:{}})).rejects.toThrow("Review state unavailable");
  });
  it("reads packages and receipts each time while only Square bookings are cached", async () => {
    const first = await getSimpleDues({ data: { forceFresh: true } });
    const calls = harness.reader.mock.calls.length;
    expect(first.totalOwed).toBe(375);
    expect(first.owingCount).toBe(1);
    expect(first.rows[0]?.visitsLeft).toBe(7);
    packages = [packageRow(200)];
    receiptCents = 10000;
    const edited = await getSimpleDues({ data: {} });
    expect(edited.totalOwed).toBe(100);
    expect(edited.rows[0]?.visitsLeft).toBe(7);
    expect(harness.reader).toHaveBeenCalledTimes(calls);
    packages = [];
    const deleted = await getSimpleDues({ data: {} });
    expect(deleted.totalOwed).toBe(0);
    expect(deleted.rows[0]?.balance).toBe(-100);
    expect(harness.reader).toHaveBeenCalledTimes(calls);
    expect(harness.started.filter(table => table === "simple_packages")).toHaveLength(3);
    expect(harness.started.filter(table => table === "square_payments")).toHaveLength(6);
  });
  it("starts independent reads before settings finish, but receipts wait for cutover", async () => {
    let release: (() => void) | undefined;
    settingsGate = new Promise<void>(resolve => { release = resolve; });
    const request = getSimpleDues({ data: { forceFresh: true } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(harness.started).toEqual(expect.arrayContaining(["simple_dues_settings", "clients", "simple_packages", "simple_opening_balances", "simple_price_list"]));
    // Display-only historical reads can start immediately; balance receipts still wait.
    expect(harness.started.filter(table => table === "square_payments")).toHaveLength(1);
    if (!release) throw new Error("Settings gate missing");
    release();
    await request;
    expect(harness.started).toContain("square_payments");
  });
  it("forced read surfaces window errors and retry recovers without changing money", async () => {
    await getSimpleDues({ data: { forceFresh: true } });
    harness.reader.mockResolvedValue({ bookings: [], error: "Square unavailable" });
    const failed = await getSimpleDues({ data: { forceFresh: true } });
    expect(failed.bookingError).toBe("Square unavailable");
    expect(failed.totalOwed).toBe(375);
    expect(failed.rows[0]?.visitsLeft).toBeNull();
    expect(failed.renewSoon).toEqual([]);
    harness.reader.mockResolvedValue({ bookings: [rawBooking], error: null });
    const recovered = await getSimpleDues({ data: { forceFresh: true } });
    expect(recovered.bookingError).toBeNull();
    expect(recovered.rows[0]?.visitsLeft).toBe(7);
    expect(recovered.totalOwed).toBe(375);
  });
  it("missing-duration warnings remain visible even from cached raw bookings", async () => {
    harness.reader.mockResolvedValue({ bookings: [{ ...rawBooking, appointment_segments: [] }], error: null });
    const first = await getSimpleDues({ data: { forceFresh: true } });
    const cached = await getSimpleDues({ data: {} });
    expect(first.bookingError).toBe("Some past appointments have no duration; visits need manual review");
    expect(cached.bookingError).toBe(first.bookingError);
    expect(cached.totalOwed).toBe(375);
    expect(cached.rows[0]?.visitsLeft).toBeNull();
  });
});

describe("shared Dues query", () => {
  it("uses three-minute freshness, five-minute polling, no focus refetch and previous data", () => {
    const query = simpleDuesQuery();
    expect(query.staleTime).toBe(180000);
    expect(query.refetchInterval).toBe(300000);
    expect(query.refetchOnWindowFocus).toBe(false);
    expect(query.placeholderData).toBe(keepPreviousData);
    expect(keepPreviousData({ totalOwed: 375 })).toEqual({ totalOwed: 375 });
  });
  it("dashboard and page reuse one result; package invalidation still rereads immediately", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = simpleDuesQuery();
    const tile = simpleDuesQuery();
    expect(page.queryKey).toEqual(tile.queryKey);
    await qc.fetchQuery({ ...page, queryFn: () => getSimpleDues({ data: { forceFresh: true } }) });
    harness.started = [];
    expect((await qc.fetchQuery(tile)).totalOwed).toBe(375);
    expect(harness.started).toEqual([]);
    packages.push({ ...packageRow(200), id: "package-two", started_on: "2026-11-25" });
    await invalidateFor(qc);
    expect((await qc.fetchQuery(page)).totalOwed).toBe(575);
    expect(harness.started).toContain("simple_packages");
    qc.clear();
  });
});