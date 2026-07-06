import { createFileRoute, useRouter } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/require-admin";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  runSquareDiagnostic,
  type SquareDiagnosticResult,
  type CustomerDiagnostic,
} from "@/lib/square-diagnostic.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/square-diagnostic")({
  beforeLoad: requireAdmin,
  component: SquareDiagnosticPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <div className="text-destructive font-semibold">Diagnostic error</div>
        <div className="text-sm">{error.message}</div>
        <Button
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function SquareDiagnosticPage() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const initial =
    params.get("ids") ??
    "DFQKDC9XZY5WW1GYDAJQHB2N2C,6ZHCWRBEYZJXBDMX13D5MFBPHB";
  const [ids, setIds] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SquareDiagnosticResult | null>(null);
  const run = useServerFn(runSquareDiagnostic);

  async function go() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const list = ids
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await run({ data: { customer_ids: list } });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Square Read-Only Diagnostic</h1>
        <p className="text-sm text-muted-foreground">
          Fetches Square customer profile, bookings, orders, and invoices for
          the given Square customer IDs. Read-only — never writes to Square or
          modifies Admin data.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder="Comma-separated Square customer IDs"
        />
        <Button onClick={go} disabled={loading}>
          {loading ? "Running…" : "Run diagnostic"}
        </Button>
      </div>
      {err && <div className="text-destructive text-sm">{err}</div>}
      {result && (
        <>
          {result.overlap && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overlap signals</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <Signal label="Same first name" value={result.overlap.same_first_name} />
                <Signal label="Same last name" value={result.overlap.same_last_name} />
                <Signal label="Shared email" value={result.overlap.shared_email} />
                <Signal label="Shared phone (last 10)" value={result.overlap.shared_phone} />
                <div>
                  Shared booking IDs:{" "}
                  <span className="font-mono">
                    {result.overlap.shared_booking_ids.length === 0
                      ? "none"
                      : result.overlap.shared_booking_ids.join(", ")}
                  </span>
                </div>
                <div>
                  Shared order IDs:{" "}
                  <span className="font-mono">
                    {result.overlap.shared_order_ids.length === 0
                      ? "none"
                      : result.overlap.shared_order_ids.join(", ")}
                  </span>
                </div>
                <div>
                  Shared invoice IDs:{" "}
                  <span className="font-mono">
                    {result.overlap.shared_invoice_ids.length === 0
                      ? "none"
                      : result.overlap.shared_invoice_ids.join(", ")}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {result.customers.map((c) => (
              <CustomerCard key={c.customer_id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span>{label}:</span>
      <Badge variant={value ? "destructive" : "secondary"}>
        {value ? "MATCH" : "different"}
      </Badge>
    </div>
  );
}

function CustomerCard({ c }: { c: CustomerDiagnostic }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-mono break-all">
          {c.customer_id}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <section>
          <div className="font-semibold">Profile</div>
          {c.profile_error && <div className="text-destructive">{c.profile_error}</div>}
          {c.profile ? (
            <div className="space-y-0.5">
              <div>
                Name: {c.profile.given_name ?? "—"} {c.profile.family_name ?? ""}
              </div>
              <div>Email: {c.profile.email_address ?? "—"}</div>
              <div>Phone: {c.profile.phone_number ?? "—"}</div>
              <div>Reference ID: {c.profile.reference_id ?? "—"}</div>
              <div>Created: {c.profile.created_at ?? "—"}</div>
              <div>Updated: {c.profile.updated_at ?? "—"}</div>
              {c.profile.note && <div>Note: {c.profile.note}</div>}
            </div>
          ) : (
            !c.profile_error && <div className="text-muted-foreground">No profile</div>
          )}
        </section>
        <section>
          <div className="font-semibold">Bookings ({c.bookings.length})</div>
          {c.bookings_error && <div className="text-destructive">{c.bookings_error}</div>}
          <ul className="max-h-48 overflow-auto space-y-0.5">
            {c.bookings.slice(0, 50).map((b) => (
              <li key={b.id} className="font-mono text-xs">
                {b.start_at ?? "?"} · {b.status ?? "?"} · {b.id}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="font-semibold">Orders ({c.orders.length})</div>
          {c.orders_error && <div className="text-destructive">{c.orders_error}</div>}
          <ul className="max-h-48 overflow-auto space-y-0.5">
            {c.orders.slice(0, 50).map((o) => (
              <li key={o.id} className="font-mono text-xs">
                {o.created_at ?? "?"} · {o.state ?? "?"} ·{" "}
                {o.total_money_cents != null
                  ? `$${(o.total_money_cents / 100).toFixed(2)}`
                  : "—"}{" "}
                · {o.id}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="font-semibold">Invoices ({c.invoices.length})</div>
          {c.invoices_error && <div className="text-destructive">{c.invoices_error}</div>}
          <ul className="max-h-48 overflow-auto space-y-0.5">
            {c.invoices.slice(0, 50).map((inv) => (
              <li key={inv.id} className="font-mono text-xs">
                {inv.created_at ?? "?"} · {inv.status ?? "?"} ·{" "}
                {inv.invoice_number ?? "—"} · {inv.id}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
